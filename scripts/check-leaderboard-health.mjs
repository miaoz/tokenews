import {readFile,appendFile} from 'node:fs/promises';
import {checkLeaderboardHealth,checkIndividualLeaderboardHealth,formatLeaderboardHealth} from './lib/leaderboard-health.mjs';
const reportPath=process.argv[2]??new URL('../data/leaderboards/refresh-status.json',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('../data/leaderboards/audit-sources.json',import.meta.url),'utf8'));
let report, readError;
try {report=JSON.parse(await readFile(reportPath,'utf8'));} catch(e) {readError=`Cannot read refresh report: ${e.message}`;}
const result=checkLeaderboardHealth(report,manifest.sources.map(s=>s.board));
if(readError)result.errors.push(readError);
const targets=JSON.parse(await readFile(new URL('../data/leaderboards/sources.json',import.meta.url),'utf8')).targets;
const individualPath=process.argv[3]??new URL('../data/leaderboards/individual-refresh-status.json',import.meta.url);
let individual;try{individual=JSON.parse(await readFile(individualPath,'utf8'));}catch{}
const individualResult=checkIndividualLeaderboardHealth(individual,targets);
const summary=formatLeaderboardHealth(result)+'\n'+formatLeaderboardHealth(individualResult).replace('Leaderboard source health:','Individual model/discovery source health:');
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
if(!result.healthy||!individualResult.healthy)process.exitCode=1;
