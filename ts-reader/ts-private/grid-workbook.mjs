import { crc32, deflateRawSync } from 'node:zlib';

const root = 'http://schemas.openxmlformats.org/';
const office = root + 'officeDocument/2006/relationships';
const sheet = root + 'spreadsheetml/2006/main';
const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function xmlText(value) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(value)) throw Error('Invalid XML characters in the report');
  return String(value).replace(/_x[\da-f]{4}_/gi, match => '_x005F_' + match.slice(1)).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// All entries are prepared in memory. Sizes and offsets fit classic ZIP for these bounded lists.
function zipXmlFiles(files) {
  const parts = [], directory = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const key = Buffer.from(name), raw = Buffer.from(xml + data), compressed = deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(key.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30); central.writeUInt32LE(offset, 42);
    parts.push(local, key, compressed); directory.push(central, key);
    offset += local.length + key.length + compressed.length;
  }
  const central = Buffer.concat(directory), count = directory.length / 2, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}

export function makeWorkbook(rows) {
  const sheetRows = rows.map((row, i) => {
    const cells = row.map((value, col) => {
      const ref = String.fromCharCode(65 + col) + (i + 1);
      return typeof value === 'number' ? '<c r="' + ref + '"><v>' + value + '</v></c>'
        : '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlText(value) + '</t></is></c>';
    });
    return '<row r="' + (i + 1) + '">' + cells.join('') + '</row>';
  });
  return zipXmlFiles({
    '[Content_Types].xml': '<Types xmlns="' + root + 'package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="' + root + 'package/2006/relationships"><Relationship Id="rId1" Type="' + office + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="' + sheet + '" xmlns:r="' + office + '"><sheets><sheet name="Allegro TS List" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="' + root + 'package/2006/relationships"><Relationship Id="rId1" Type="' + office + '/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet xmlns="' + sheet + '"><sheetData>' + sheetRows.join('') + '</sheetData></worksheet>'
  });
}
