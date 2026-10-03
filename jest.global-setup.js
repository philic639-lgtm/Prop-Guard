// Run tests in exchange time so day boundaries are deterministic.
module.exports = async () => {
  process.env.TZ = 'America/New_York';
};
