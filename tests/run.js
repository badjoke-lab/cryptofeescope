const { runFeeTests } = require('./fee.test');
const { runPriceTests } = require('./price.test');
const { runSnapshotTests } = require('./snapshot.test');

(async () => {
  await runFeeTests();
  await runPriceTests();
  await runSnapshotTests();
  if (process.exitCode) process.exit(process.exitCode);
})();
