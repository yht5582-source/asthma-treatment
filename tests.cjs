// node tests.cjs — tests the decision engine embedded in index.html (/*ENGINE-START*/…/*ENGINE-END*/)
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const src = html.slice(html.indexOf('/*ENGINE-START*/'), html.indexOf('/*ENGINE-END*/'));
const ctx = { module: { exports: {} } };
vm.runInNewContext(src, ctx);
const AE = ctx.module.exports;

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want));
}

/* ---- Table 2A ---- */
t('ctrl well', AE.ctrlLevel([0,0,0,0]).level, 'well');
t('ctrl partly 2', AE.ctrlLevel([1,0,1,0]).level, 'partly');
t('ctrl un 3', AE.ctrlLevel([1,1,1,0]).level, 'un');
t('ctrl un with Q3 n/a', AE.ctrlLevel([1,1,'na',1]).level, 'un');
t('ctrl partly with Q3 n/a', AE.ctrlLevel([1,0,'na',1]).level, 'partly');
t('ctrlComplete n/a only Q3', AE.ctrlComplete([0,0,'na',0]), true);
t('ctrlComplete n/a not allowed Q1', AE.ctrlComplete(['na',0,0,0]), false);
t('ctrlComplete missing', AE.ctrlComplete([0,null,0,0]), false);

/* ---- Table 1 diagnosis ---- */
const typ = [0,1,2];
t('adult BDR +', AE.dxEval({age:'ad18', sx:typ, obj:{pre:2.0, post:2.3}}).key, 'confirmed');        // +300 mL, 15%
t('adult BDR 12% but <200 mL', AE.dxEval({age:'ad18', sx:typ, obj:{pre:1.2, post:1.38}}).objPos, false); // +180 mL
t('adult BDR ≥200 mL but <12%', AE.dxEval({age:'ad18', sx:typ, obj:{pre:2.5, post:2.75}}).objPos, false); // +250 mL, 10%
t('adult FVC response counts', AE.dxEval({age:'ad18', sx:typ, obj:{pre:2.5, post:2.6, fvcPre:3.5, fvcPost:4.0}}).objPos, true);
t('adult PEF BDR ≥20%', AE.dxEval({age:'ad18', sx:typ, obj:{pefPre:300, pefPost:360}}).objPos, true);
t('adult PEF BDR 15% neg', AE.dxEval({age:'ad18', sx:typ, obj:{pefPre:300, pefPost:345}}).objPos, false);
t('child PEF BDR 15% pos', AE.dxEval({age:'ch617', sx:typ, obj:{pefPre:200, pefPost:230}}).objPos, true);
t('child BDR % predicted', AE.dxEval({age:'ch617', sx:typ, obj:{pre:1.6, post:1.85, pred:2.0}}).objPos, true); // 12.5% pred
t('child BDR no predicted → indeterminate not negative', (r=>[r.objPos,r.neg.length,r.ind.length])(AE.dxEval({age:'ch617', sx:typ, obj:{pre:1.6, post:1.9}})), [false,0,1]);
t('PEF variability adult >10', AE.dxEval({age:'ad18', sx:typ, obj:{pef:11}}).objPos, true);
t('PEF variability adult =10 neg', AE.dxEval({age:'ad18', sx:typ, obj:{pef:10}}).objPos, false);
t('PEF variability child 12 neg', AE.dxEval({age:'ch617', sx:typ, obj:{pef:12}}).objPos, false);
t('PEF variability child 14 pos', AE.dxEval({age:'ch617', sx:typ, obj:{pef:14}}).objPos, true);
t('ratio alone not variability', AE.dxEval({age:'ad18', sx:typ, obj:{ratio:0.6}}).key, 'needTests');
t('other criterion: challenge test', AE.dxEval({age:'ad18', sx:typ, other:[1]}).key, 'confirmed');
t('objective only, atypical hx', AE.dxEval({age:'ad18', sx:[1], obj:{pef:15}}).key, 'objOnly');
t('typical needs symptom item', AE.dxEval({age:'ad18', sx:[1,2,3], obj:{pef:15}}).key, 'objOnly');
t('sx only, tests negative', AE.dxEval({age:'ad18', sx:typ, obj:{pef:5}}).key, 'sxOnly');
t('sx + FeNO high, no tests', AE.dxEval({age:'ad18', sx:typ, obj:{feno:60}}).key, 'sxT2');
t('FeNO 50 adult not high', AE.dxEval({age:'ad18', sx:typ, obj:{feno:50}}).key, 'needTests');
t('FeNO 40 child high', AE.dxEval({age:'ch617', sx:typ, obj:{feno:40}}).key, 'sxT2');
t('insufficient', AE.dxEval({age:'ad18', sx:[], obj:{}}).key, 'insufficient');
t('out-of-range ignored (FEV1 in mL)', (r=>[r.bad,r.objPos])(AE.dxEval({age:'ad18', sx:typ, obj:{pre:2100, post:2500}})), [['pre','post'],false]);

/* ---- Treatment decisions ---- */
const base = {age:'a12', track:'t1', init:null, ctrlDur:'lt3', risk:[]};
const tx = p => (d=>[d.rec,d.act])(AE.txDecide({...base, ...p}));
t('T1 uncontrolled at Step 1–2 → Step 3', tx({cur:2, ctrl:[1,1,'na',1]}), [3,'up']);
t('T1 Step 1 treated as 1–2', tx({cur:1, ctrl:[1,0,'na',0]}), [3,'consider']);
t('T1 well at Step 1–2 stays (lowest)', tx({cur:2, ctrl:[0,0,'na',0], ctrlDur:'ge3'}), [2,'stay']);
t('T1 Step 3 well 3 mo → Step 1–2', tx({cur:3, ctrl:[0,0,'na',0], ctrlDur:'ge3'}), [2,'down']);
t('T1 Step 4 well <3 mo stays', tx({cur:4, ctrl:[0,0,'na',0]}), [4,'stay']);
t('well but risk factor → hold', tx({cur:4, ctrl:[0,0,'na',0], ctrlDur:'ge3', risk:[7]}), [4,'stay']);
t('Step 5 uncontrolled → top (not "step up")', tx({cur:5, ctrl:[1,1,'na',1]}), [5,'top']);
t('T2 Step 2 well → Step 1', tx({track:'t2', cur:2, ctrl:[0,0,0,0], ctrlDur:'ge3'}), [1,'down']);
t('T2 Step 1 well stays', tx({track:'t2', cur:1, ctrl:[0,0,0,0], ctrlDur:'ge3'}), [1,'stay']);
t('T2 partly at Step 3 → 4', tx({track:'t2', cur:3, ctrl:[1,0,0,0]}), [4,'consider']);
t('untreated Table 3 row 0, T1 → Step 1–2', tx({cur:0, init:'0', ctrl:[0,0,'na',0]}), [2,'start']);
t('untreated Table 3 row 0, T2 → Step 1', tx({track:'t2', cur:0, init:'0', ctrl:[0,0,0,0]}), [1,'start']);
t('untreated Table 3 row 2 → Step 3', tx({cur:0, init:'2', ctrl:[1,1,'na',0]}), [3,'start']);
t('untreated exacerbation → Step 4', tx({cur:0, init:'4', ctrl:[1,1,'na',1]}), [4,'start']);
t('untreated: Table row not overridden by control', tx({track:'t2', cur:0, init:'0', ctrl:[1,1,1,1]}), [1,'start']);
t('untreated mismatch flagged', AE.txDecide({...base, track:'t2', cur:0, init:'0', ctrl:[1,1,1,1]}).notes, ['mismatch']);
t('child 6–11 Step 2 partly → 3', tx({age:'a611', track:null, cur:2, ctrl:[1,0,0,0]}), [3,'consider']);
t('child 6–11 step down note', AE.txDecide({...base, age:'a611', track:null, cur:3, ctrl:[0,0,0,0], ctrlDur:'ge3'}).notes, ['child3m']);
t('child 6–11 Step 5 uncontrolled → top', tx({age:'a611', track:null, cur:5, ctrl:[1,1,1,1]}), [5,'top']);
t('≤5 Step 4 uncontrolled → top', tx({age:'a5', track:null, cur:4, ctrl:[1,1,1,0]}), [4,'top']);
t('≤5 untreated uncontrolled → Step 2', tx({age:'a5', track:null, cur:0, ctrl:[1,1,0,0]}), [2,'start']);
t('≤5 untreated well → Step 1', tx({age:'a5', track:null, cur:0, ctrl:[0,0,0,0]}), [1,'start']);
t('stepLabel T1', AE.stepLabel('a12','t1',2), 'Step 1–2');
t('stepLabel T2', AE.stepLabel('a12','t2',2), 'Step 2');
t('stepLabel child', AE.stepLabel('a611',null,1), 'Step 1');

/* ---- Figure 9 severity ---- */
const SG = [{c:'sev'},{c:'life'},{c:'mod'},{c:'mild'},{c:'mild'},{c:'mild'}];
const ac = (picked, pram=null) => (r=>[r.key,r.incomplete])(AE.acuteClassify(SG, picked, pram));
t('all mild → mild', ac([3,4,5]), ['mild',false]);
t('partial mild → moderate (incomplete)', ac([3,4]), ['mod',true]);
t('any moderate', ac([2,3,4,5]), ['mod',false]);
t('any severe overrides', ac([0,2,3]), ['sev',false]);
t('life overrides', ac([1,0]), ['life',false]);
t('PRAM 2 + all mild', ac([3,4,5], 2), ['mild',false]);
t('PRAM 5 → moderate', ac([3,4,5], 5), ['mod',false]);
t('PRAM 9 → severe', ac([3,4,5], 9), ['sev',false]);
t('PRAM 11 → life', ac([], 11), ['life',false]);
t('PRAM bands', [0,3,4,7,8,10,11,12].map(AE.pramBand), ['mild','mild','mod','mod','sev','sev','life','life']);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
