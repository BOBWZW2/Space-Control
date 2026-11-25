import { makeWorkbook } from './grid-workbook.mjs';

export const reportColumns = ['No.', 'Vessel Voyage', 'Container No.', 'Type/Size', 'Gross Weight (Incl. Tare WT)',
  'POR', 'POL', 'POD', 'DEL', 'T/S', 'Former Vessel Voyage', 'Lane', 'Move Event Date', 'Event Yard', 'Move Status'];

function unconfirmed() {
  return Object.assign(Error('未能逐箱核对 Allegro 明细、箱数、TEU 和含箱皮毛重。'), {code:'grid_unconfirmed',status:422});
}
const fieldKey = v => String(v).trim().replace(/\s+/g,' ').toUpperCase();
const headerKey = v => fieldKey(v).replace(/[^A-Z0-9]/g,'');

export function indicesForHeader(headerRows) {
  // Expand a multi-row HTML header exactly as a table lays out rowspan/colspan.
  const height = Math.max(headerRows.length, ...headerRows.flatMap((cells,i)=>cells.map(cell=>i+cell.height)));
  if (!Number.isSafeInteger(height) || height<1 || height>32) throw unconfirmed();
  const matrix = Array.from({length:height},()=>[]);
  for (const [ri, cells] of headerRows.entries()) {
    let col = 0;
    for (const cell of cells) {
      while (matrix[ri][col] != null) col++;
      const {label, width, height} = cell;
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || ri + height > matrix.length || col + width > 256) throw unconfirmed();
      for (let r = ri; r < ri + height; r++) {
        for (let c = col; c < col + width; c++) {
          if (matrix[r][c] != null) throw unconfirmed();
          matrix[r][c] = headerKey(label);
        }
      }
      col += width;
    }
  }
  const byName = new Map();
  const width = Math.max(...matrix.map(row=>row.length));
  for (let c = 0; c < width; c++) {
    const path = [...new Set(matrix.map(row=>row[c]).filter(Boolean))];
    const label = reportColumns.find(name=>path.includes(headerKey(name)));
    if (!label) continue;
    if (['POR','POL','POD','DEL'].includes(label) && path.length>1 && !path.includes('PORT')) continue;
    if (byName.has(label)) throw unconfirmed();
    byName.set(label,c);
  }
  return {byName,width};
}

function kgInGrams(value) {
  const s = String(value).trim();
  const match = s.match(/^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,3}))?$/);
  if (!match) throw unconfirmed();
  const grams = Number(match[1].replaceAll(',','')) * 1000 + Number((match[2] || '').padEnd(3,'0'));
  if (!Number.isSafeInteger(grams)) throw unconfirmed();
  return grams;
}

export function verifyRows(rowMap, totals) {
  const {boxes,teu,vvd,port,gross} = totals;
  if (!Number.isSafeInteger(boxes) || boxes < 1 || rowMap.size !== boxes) throw unconfirmed();
  const ids = new Set(), rows = [[...reportColumns, 'eqGrpSize']];
  let actualGrams = 0, actualTeu = 0;
  for (let n=1;n<=boxes;n++) {
    const row = rowMap.get(n);
    if (!row || row.length!==reportColumns.length) throw unconfirmed();
    const [ordinal,next,container,size,weight]=row;
    const box = fieldKey(container), origin = fieldKey(row[6]);
    const ts = fieldKey(row[9]).replace(/[^A-Z]/g,'');
    const equipment = fieldKey(size).match(/^(20|40|45)(?:\s*[-']?\s*[A-Z0-9]+)?$/);
    if (Number(ordinal)!==n || fieldKey(next)!==vvd || origin!==port || !box || ids.has(box) || !equipment ||
        !['TO','TI','TS','TSOUT','TSIN','TRANSSHIPMENT','TRANSHIPMENT'].includes(ts)) throw unconfirmed();
    ids.add(box);
    const grams = kgInGrams(weight), perBox = equipment[1]==='20'?1:2;
    actualGrams += grams; actualTeu += perBox;
    const out = [...row,perBox];
    out[0] = n; out[4] = grams / 1000;
    rows.push(out);
  }
  if (actualTeu!==teu || actualGrams!==kgInGrams(gross)) throw unconfirmed();
  return rows;
}

export function mergeViewport(rowMap, snapshot) {
  const maps = snapshot.headers.map(indicesForHeader);
  const layout = reportColumns.map(name => {
    const matches = maps.flatMap(({byName},side) => byName.has(name) ? [[side,byName.get(name)]] : []);
    if (matches.length!==1) throw unconfirmed();
    return matches[0];
  });
  for (const [index,pair] of snapshot.pairs.entries()) {
    if (pair.some((cells,side)=>{
      const surplus=cells.length-maps[side].width;
      return surplus<0 || surplus>(snapshot.trailingHidden?.[index]?.[side] || 0);
    })) throw unconfirmed();
    const row = layout.map(([side,index])=>pair[side][index].trim());
    const no = Number(row[0]);
    if (!/^\d+$/.test(row[0]) || !Number.isSafeInteger(no) || no<=0) throw unconfirmed();
    if (rowMap.has(no) && JSON.stringify(row)!==JSON.stringify(rowMap.get(no))) throw unconfirmed();
    rowMap.set(no,row);
  }
}

// Runs inside the already open, user-authorized report frame. Only rendered HTML tables and
// their native scrollbar are consulted. No framework objects, network calls or storage access.
export function readViewport(action) {
  const shown = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const ownRows = table => Array.from(table.rows).filter(tr=>tr.closest('table')===table);
  const normalize = s => s.replace(/\s+/g,' ').trim();
  function cellLabel(cell) {
    const control = cell.querySelector('input:not([type=hidden]),select,textarea');
    const txt = normalize(cell.innerText || (cell.tagName==='TH' ? cell.textContent : '') || '');
    if (txt || !control || !shown(control)) return txt;
    if (control.tagName==='SELECT') return normalize(control.options[control.selectedIndex]?.text || '');
    if (control.type==='checkbox' || control.type==='radio') return control.checked?'Y':'N';
    return normalize(control.value || '');
  }
  function paneLayout(pane, anchor) {
    const tables = Array.from(pane.querySelectorAll('table')).filter(shown);
    const candidates = tables.filter(t=>!t.closest('.grid-body-pnl') &&
      ownRows(t).some(tr=>Array.from(tr.cells).some(cell=>cellLabel(cell)===anchor)));
    if (candidates.length!==1) return null;
    const header = ownRows(candidates[0]).filter(tr=>shown(tr) && tr.getBoundingClientRect().height>0 &&
      Array.from(tr.cells).some(c=>cellLabel(c)));
    const headings = header.map(row=>Array.from(row.cells).filter(c=>!c.classList.contains('grid-extra-cell')).map(c=>({label:cellLabel(c),width:c.colSpan,height:c.rowSpan})));
    const panels = pane.querySelectorAll('.grid-body-pnl');
    if (panels.length!==1) return null;
    const tablesInBody = Array.from(panels[0].querySelectorAll('table')).filter(t=>ownRows(t).length>1 && shown(t));
    if(tablesInBody.length!==1) return null;
    const rows = ownRows(tablesInBody[0]);
    return {headings,rows};
  }
  const grids = Array.from(document.querySelectorAll('.grid-pnl')).filter(el=>shown(el) &&
    el.querySelector('.grid-left-pnl .grid-body-pnl') &&
    Array.from(el.querySelectorAll('th,td')).some(cell=>cellLabel(cell)==='Former Vessel Voyage'));
  if (grids.length!==1) return {problem:'grid'};
  const grid=grids[0];
  const panes = Array.from(grid.querySelectorAll('.grid-body-pnl')).map(body=>{
    let panel=body.parentElement;
    while(panel && panel!==grid && !Array.from(panel.querySelectorAll('table')).some(t=>!t.closest('.grid-body-pnl'))) panel=panel.parentElement;
    return panel;
  });
  if (panes.length!==2 || panes[0]===panes[1]) return {problem:'panes'};
  const left=panes.find(p=>p.classList.contains('grid-left-pnl')), right=panes.find(p=>p!==left);
  if(!left || !right) return {problem:'panes'};
  const a=paneLayout(left,'Container No.'), b=paneLayout(right,'Type/Size');
  if(!a || !b || !a.rows.length) return {problem:'rows'};
  const leftLabels=a.headings.flat();
  const ordinalCol=leftLabels.findIndex(c=>c.label.replace(/[^a-zA-Z]/g,'').toLowerCase()==='no');
  if(ordinalCol<0) return {problem:'head'};
  const pairs=[],trailingHidden=[];
  function tailCount(row) {
    let n=0;
    for(let i=row.cells.length-1;i>=0;i--) {
      const cell=row.cells[i];
      if(!cell.classList.contains('grid-extra-cell') && getComputedStyle(cell).display!=='none') break;
      n++;
    }
    return n;
  }
  for(const ra of a.rows) {
    if (!ra.cells[ordinalCol] || !/^\d+$/.test(cellLabel(ra.cells[ordinalCol]))) continue;
    const rb=b.rows.find(row=>row.rowIndex===ra.rowIndex);
    if(!rb) return {problem:'align'};
    const ba=ra.getBoundingClientRect(), bb=rb.getBoundingClientRect();
    if (Math.abs(ba.top-bb.top)>1.5 || Math.abs(ba.height-bb.height)>1.5) return {problem:'align'};
    pairs.push([Array.from(ra.cells,cellLabel),Array.from(rb.cells,cellLabel)]);
    trailingHidden.push([tailCount(ra),tailCount(rb)]);
  }
  if(!pairs.length) return {problem:'rows'};
  const weights=Array.from(document.querySelectorAll('tr')).filter(tr=>shown(tr) && !tr.closest('.grid-pnl') &&
    !tr.querySelector('tr')).map(tr=>normalize(tr.innerText)).map(str=>str.match(/\bGross\s+Weight\s*:\s*(\d[\d,.]*)\s*.*\bCargo\s+Weight\s*:/i)?.[1]).filter(Boolean);
  if (weights.length!==1) return {problem:'gross'};
  let scrollAt=0, maxScroll=0;
  if(action.needScrollbar) {
    const bars=Array.from(grid.querySelectorAll('.grid-center-pnl > div')).filter(el=>{
      if(!shown(el) || el.clientHeight<30 || el.clientWidth>50 || el.scrollHeight<=el.clientHeight || el.closest('.grid-body-pnl')) return false;
      return ['auto','scroll','overlay','hidden'].includes(getComputedStyle(el).overflowY);
    });
    if (bars.length!==1) return {problem:'scroll'};
    const bar=bars[0];
    scrollAt=bar.scrollTop; maxScroll=bar.scrollHeight-bar.clientHeight;
    if (action.target==='reset') bar.scrollTop=0;
    if (action.target==='next') bar.scrollTop=Math.min(maxScroll,scrollAt+Math.max(1,Math.floor(bar.clientHeight*0.70)));
  }
  return {headers:[a.headings,b.headings],pairs,trailingHidden,gross:weights[0],scrollAt,maxScroll};
}

export async function workbookFromVisibleGrid(frame,{vvd,port,boxes,teu,timeoutMs=22000}) {
  const end=Date.now()+timeoutMs, rows=new Map();
  let gross, previous='';
  // The report opens at row 1; overlapping positions reveal stale split panes during repaint.
  let snapshot=await frame.evaluate(readViewport,{});
  if (snapshot.problem) throw unconfirmed();
  mergeViewport(rows,snapshot);
  gross=snapshot.gross;
  let stalls=0;
  while(rows.size<boxes && Date.now()<end) {
    const advance = await frame.evaluate(readViewport,{needScrollbar:true,target:'next'});
    if (advance.problem || advance.gross!==gross) throw unconfirmed();
    mergeViewport(rows,advance);
    const previousWindow=advance.pairs.map(pair=>pair[0].join('\u001f')).join('\u001e');
    do {
      await new Promise(resolve=>setTimeout(resolve,80));
      snapshot=await frame.evaluate(readViewport,{needScrollbar:true});
      if(snapshot.problem && !['align','rows'].includes(snapshot.problem)) throw unconfirmed();
      if(!snapshot.problem && snapshot.pairs.map(pair=>pair[0].join('\u001f')).join('\u001e')!==previousWindow) break;
      if(snapshot.scrollAt===snapshot.maxScroll && advance.scrollAt===advance.maxScroll) break;
    } while(Date.now()<end);
    if(snapshot.problem || snapshot.gross!==gross) throw unconfirmed();
    mergeViewport(rows,snapshot);
    const stamp=rows.size+'|'+snapshot.scrollAt;
    if(stamp===previous && ++stalls>=2) break;
    if(stamp!==previous) stalls=0;
    previous=stamp;
  }
  const verified=verifyRows(rows,{vvd,port,boxes,teu,gross});
  return makeWorkbook(verified);
}
