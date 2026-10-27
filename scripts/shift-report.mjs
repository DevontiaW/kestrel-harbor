// Prints the agent floor's numbers for a full 8-hour shift (480 minutes, all services up) with 1, 2 and 3 reviewers.
// Usage: node scripts/shift-report.mjs   (deterministic; the same output every run)
import { AgentFloor } from '../agent-floor.mjs';
import { District } from '../district-model.mjs';

const SHIFT = 480;
for (const reviewers of [1, 2, 3]) {
  const floor = new AgentFloor({ reviewers });
  for (let i = 0; i < SHIFT; i++) floor.tick({ internet: true, power: true });
  const m = floor.metrics();
  const district = new District(); district.setReviewers(reviewers); district.advance(SHIFT);
  const review = m.stations.find(s => s.id === 'review');
  console.log(JSON.stringify({
    reviewers, arrived: m.arrived, finished: m.done, stillInSystem: m.wip,
    finishedPerHour: +m.throughputPerHour.toFixed(2), avgCompletedCycleMin: +m.avgCycle.toFixed(1),
    waitingForReview: review.queued, reviewBusyPct: +(review.utilization * 100).toFixed(1),
    taskMinutes: m.wait, sameInsideDistrict: JSON.stringify(district.floor.metrics()) === JSON.stringify(m), harborStBlocked: district.blocked,
  }));
}
