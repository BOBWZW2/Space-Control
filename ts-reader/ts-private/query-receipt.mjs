const stages = new Set(['claim','smoke','browser','shell','menu','report','criteria','call','search','totals','download','file','store','ready']);
const failures = {
  invalid_parameters:400, bad_selection:400, reader_config:502, invalid_session:502,
  login_required:401, access_denied:403, ambiguous_call:409, no_calls:409, mixed_local:409,
  selection_changed:409, workbook_size:413, unknown_size:422, invalid_file:422,
  busy:429, landing_unverified:502, manifest_mismatch:502, call_mismatch:502,
  download_failed:502,invalid_workbook:502,source_tls:502,native_query_failed:502,
  shell_unavailable:503,menu_unavailable:503,report_unavailable:503,job_store_unavailable:503,
  upstream_timeout:504,query_timeout:504,unconfirmed:504,totals_unconfirmed:504,
  upstream_error:502
};

export function queryStage(stage) {
  if(stages.has(stage))console.info('ts-query stage',stage);
}

export function queryFailure(code) {
  if(typeof code !== 'string'||!Object.hasOwn(failures,code))code='upstream_error';
  return {kind:'query-error',code,status:failures[code]};
}
