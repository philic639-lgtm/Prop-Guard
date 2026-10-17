// Supplied engine/vision tests (engine.test.ts), ported from node:test to Jest
// unchanged in substance.
import { evaluateSetup, type Input } from '../setupCheck/engine';
import { analyzeScreenshot } from '../setupCheck/vision';

function fixture(): Input {
  return { rules:Array.from({length:12},(_,i) => ({id:`r${i}`,label:`Rule ${i}`,required:true,critical:true})),
    evidence:Array.from({length:12},(_,i) => ({ruleId:`r${i}`,status:'PASS',source:'manual',confidence:1,reason:'Trader confirmed saved rule.'})),
    trade:{side:'LONG',entry:5000,stop:4995,target:5010,quantity:1,pointValue:5,costs:0,slippage:0,minimumRR:1.5,maxRisk:100},
    prop:{mode:'prop',verified:true,rulesCurrent:true,drawdownBuffer:1000,dailyLossRemaining:300,maxContracts:5,reserve:50,
      otherChecks:[{ruleId:'restrictions',status:'PASS',source:'manual',confidence:1,reason:'All other applicable account restrictions confirmed.'}]},analysisMode:'REAL'};
}

describe('supplied engine tests', () => {
  test('12/12 confirmed and valid risk -> TAKE TRADE',() => {
    const r=evaluateSetup(fixture()); expect(r.decision).toBe('TAKE TRADE'); expect(r.ruleAlignmentScore).toBe(100); expect(r.dollarRisk).toBe(25); expect(r.rr).toBe(2);
  });
  test('6/12 -> 50 and WAIT',() => {const i=fixture();i.evidence=i.evidence.slice(0,6);const r=evaluateSetup(i);expect(r.ruleAlignmentScore).toBe(50);expect(r.decision).toBe('WAIT');expect(r.blockers.length).toBe(6);});
  test('critical failure -> STAND DOWN',() => {const i=fixture();i.evidence[0].status='FAIL';expect(evaluateSetup(i).decision).toBe('STAND DOWN');});
  test('missing stop -> WAIT, no calculated risk',() => {const i=fixture();delete i.trade.stop;const r=evaluateSetup(i);expect(r.decision).toBe('WAIT');expect(r.dollarRisk).toBe(null);expect(r.propFirmCompliance).toBe('UNVERIFIED');});
  test('bad R:R -> STAND DOWN',() => {const i=fixture();i.trade.target=5001;expect(evaluateSetup(i).decision).toBe('STAND DOWN');});
  test('drawdown violation -> STAND DOWN',() => {const i=fixture();i.prop.drawdownBuffer=70;expect(evaluateSetup(i).decision).toBe('STAND DOWN');});
  test('exact buffer boundary is blocked',() => {const i=fixture();i.prop.drawdownBuffer=75;expect(evaluateSetup(i).decision).toBe('STAND DOWN');});
  test('demo evidence scores zero and cannot TAKE',() => {const i=fixture();i.analysisMode='DEMO';i.evidence.forEach(e=>e.source='demo');const r=evaluateSetup(i);expect(r.ruleAlignmentScore).toBe(0);expect(r.decision).toBe('WAIT');});
  test('vision evidence rejected in demo mode',() => {const i=fixture();i.analysisMode='DEMO';i.evidence.forEach(e=>e.source='vision');expect(evaluateSetup(i).ruleAlignmentScore).toBe(0);});
  test('wrong price direction -> STAND DOWN',() => {const i=fixture();i.trade.stop=5005;expect(evaluateSetup(i).decision).toBe('STAND DOWN');});
  test('missing firm verification -> WAIT',() => {const i=fixture();i.prop.verified=false;expect(evaluateSetup(i).decision).toBe('WAIT');});
  test('unknown firm buffer -> WAIT',() => {const i=fixture();delete i.prop.dailyLossRemaining;expect(evaluateSetup(i).decision).toBe('WAIT');});
  test('fees and slippage increase risk and reduce reward',() => {const i=fixture();i.trade.costs=2;i.trade.slippage=3;const r=evaluateSetup(i);expect(r.dollarRisk).toBe(30);expect(r.reward).toBe(45);expect(r.rr).toBe(1.5);});
  test('short direction and contract limits',() => {const i=fixture();i.trade.side='SHORT';i.trade.stop=5005;i.trade.target=4990;expect(evaluateSetup(i).decision).toBe('TAKE TRADE');i.prop.maxContracts=0.5;expect(evaluateSetup(i).decision).toBe('WAIT');i.trade.quantity=6; i.prop.maxContracts=5;expect(evaluateSetup(i).decision).toBe('STAND DOWN');});
  test('missing RR and risk budget cannot pass',() => {const i=fixture();delete i.trade.minimumRR;expect(evaluateSetup(i).decision).toBe('WAIT');});
  test('no required strategy rules cannot TAKE',() => {const i=fixture();i.rules=[];expect(evaluateSetup(i).decision).toBe('WAIT');});
  test('duplicate or low confidence evidence cannot pass',() => {const i=fixture();i.evidence.push({...i.evidence[0]});expect(evaluateSetup(i).decision).toBe('WAIT');i.evidence.pop();i.evidence[0].source='vision';i.evidence[0].confidence=0.3;expect(evaluateSetup(i).decision).toBe('WAIT');});
  test('required noncritical failure -> WAIT',() => {const i=fixture();i.rules[0].critical=false;i.evidence[0].status='FAIL';expect(evaluateSetup(i).decision).toBe('WAIT');});
  test('optional failure does not inflate score or block',() => {const i=fixture();i.rules.push({id:'optional',label:'Optional',required:false,critical:false});i.evidence.push({ruleId:'optional',status:'FAIL',source:'manual',confidence:1,reason:'Optional condition failed.'});expect(evaluateSetup(i).decision).toBe('TAKE TRADE');});
  test('provider unavailable stays unverified',async () => {const r=await analyzeScreenshot({bytes:new Uint8Array([1]),mime:'image/png'},fixture().rules);expect(r.mode).toBe('UNAVAILABLE');expect(r.evidence.every(e=>e.status==='UNVERIFIED')).toBe(true);});
  test('provider receives image and returned evidence controls score',async () => {
    const i=fixture();const bytes=new Uint8Array([1,2,3]);
    const r=await analyzeScreenshot({bytes,mime:'image/png'},i.rules,{analyze:async request=>{
      expect(request.image.bytes).toBe(bytes);expect(request.ruleIds.length).toBe(12);
      return {observations:i.rules.map((rule,n)=>({ruleId:rule.id,status:n<6?'PASS':'UNVERIFIED',confidence:0.95,reason:n<6?'Visible chart evidence':'Timeframe absent.'}))};
    }});i.evidence=r.evidence;i.analysisMode=r.mode;expect(evaluateSetup(i).ruleAlignmentScore).toBe(50);expect(evaluateSetup(i).decision).toBe('WAIT');
  });
  test('provider failure never fabricates evidence',async () => {const r=await analyzeScreenshot({bytes:new Uint8Array([1]),mime:'image/png'},fixture().rules,{analyze:async()=>{throw new Error('Unavailable');}});expect(r.mode).toBe('UNAVAILABLE');expect(r.evidence.every(e=>e.status==='UNVERIFIED')).toBe(true);});
  test('malformed and duplicate AI observations rejected',async () => {const r=await analyzeScreenshot({bytes:new Uint8Array([1]),mime:'image/png'},fixture().rules,{analyze:async()=>({observations:[{ruleId:'r0',status:'PASS',confidence:1,reason:'One'},{ruleId:'r0',status:'PASS',confidence:1,reason:'Two'}]})});expect(r.evidence.every(e=>e.status==='UNVERIFIED')).toBe(true);});
});
