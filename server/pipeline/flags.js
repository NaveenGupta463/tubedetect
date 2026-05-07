function isNewPipelineEnabled() {
  return process.env.USE_NEW_PIPELINE === '1';
}

module.exports = { isNewPipelineEnabled };
