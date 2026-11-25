const stages = new Set([
  'claim','smoke','browser','shell','menu','report','criteria','call','search','totals','download',
  'criteria_mode','criteria_voyage','criteria_port','criteria_calls',
  'export_popup','export_post','export_post_large','export_response','export_confirm',
  'export_event','export_event_recovery','export_blob','export_dialog_blocked','grid_read','file','store','ready'
]);
const failures = {
  invalid_parameters:400, bad_selection:400, reader_config:502, invalid_session:502,
  login_required:401, access_denied:403, ambiguous_call:409, no_calls:409, mixed_local:409,
  selection_changed:409, workbook_size:413, unknown_size:422, grid_unconfirmed:422, invalid_file:422,
  busy:429, landing_unverified:502, manifest_mismatch:502, call_mismatch:502,
  download_failed:502,invalid_workbook:502,source_tls:502,native_query_failed:502,
  shell_unavailable:503,menu_unavailable:503,report_unavailable:503,job_store_unavailable:503,
  form_not_ready:503,mode_not_ready:503,voyage_not_ready:503,port_not_ready:503,
  upstream_timeout:504,query_timeout:504,unconfirmed:504,totals_unconfirmed:504,
  upstream_error:502
};

export function queryStage(stage) {
  if(stages.has(stage))console.info('ts-query stage',stage);
}

// Browser diagnostics can fire several times per native interaction. Persist only
// user-facing milestones, with one ordered write in flight per authenticated job.
const milestones = new Map([
  ['browser','opening'], ['criteria','criteria'], ['search','searching'],
  ['download','exporting'], ['grid_read','reading_grid'], ['file','returning']
]);
export function progressReporter(write) {
  let current = 'queued', writing = Promise.resolve();
  return {
    stage(name) {
      queryStage(name);
      const next = milestones.get(name);
      if (!next || next===current) return;
      current = next;
      writing = writing.then(()=>next===current ? write(next) : undefined)
        .catch(()=>{}); // A transient progress outage does not discard the manifest.
    },
    finish() { return writing; }
  };
}

export function queryFailure(code) {
  if(typeof code !== 'string'||!Object.hasOwn(failures,code))code='upstream_error';
  return {kind:'query-error',code,status:failures[code]};
}
