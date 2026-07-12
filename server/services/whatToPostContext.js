const { resolveCreatorPeerContext } = require('./creatorPeerContext');
const {
  STOPWORDS,
  HOOK_PHRASES,
  DEVANAGARI_RE,
  SOUTH_SCRIPT_RE,
  extractPhrases,
} = require('../lib/phrases');
const { PODCAST_META_TOKENS } = require('../lib/creatorMode');
const {
  classifyTrend,
  getVelocity,
  getFormatWinner,
} = require('./topicAnalysis');

function buildWhatToPostContext() {
  return {
    resolveCreatorPeerContext,
    extractPhrases,
    getVelocity,
    classifyTrend,
    getFormatWinner,
    PODCAST_META_TOKENS,
    STOPWORDS,
    HOOK_PHRASES,
    SOUTH_SCRIPT_RE,
    DEVANAGARI_RE,
  };
}

module.exports = { buildWhatToPostContext };
