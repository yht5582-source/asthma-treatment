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


/* ---- v2.1 fixes ---- */
t('BDR exactly 12% despite float (2.5→2.8)', AE.dxEval({age:'ad18', sx:typ, obj:{pre:2.5, post:2.8}}).objPos, true);
t('BDR child exactly 12% predicted', AE.dxEval({age:'a611', sx:typ, obj:{pre:1.5, post:1.74, pred:2.0}}).objPos, true);
t('FVC-only BDR counts in adults', AE.dxEval({age:'ad18', sx:typ, obj:{fvcPre:3.5, fvcPost:4.0}}).key, 'confirmed');
t('FVC-only BDR under 200 mL', AE.dxEval({age:'ad18', sx:typ, obj:{fvcPre:1.0, fvcPost:1.15}}).objPos, false);
t('FeNO 40 adolescent not high (>50)', AE.dxEval({age:'a1217', sx:typ, obj:{feno:40}}).key, 'needTests');
t('FeNO 60 adolescent high', AE.dxEval({age:'a1217', sx:typ, obj:{feno:60}}).key, 'sxT2');
t('FeNO 40 child 6–11 high', AE.dxEval({age:'a611', sx:typ, obj:{feno:40}}).key, 'sxT2');
t('adolescent keeps child BDR rule', AE.dxEval({age:'a1217', sx:typ, obj:{pre:1.6, post:1.85, pred:2.0}}).objPos, true);
t('adolescent PEF variability cut 13', AE.dxEval({age:'a1217', sx:typ, obj:{pef:12}}).objPos, false);
t('n/a refused when not allowed', AE.ctrlComplete([0,0,'na',0], false), false);
t('n/a accepted when allowed', AE.ctrlComplete([0,0,'na',0], true), true);
t('poor adherence: fix, not step up', (d=>[d.rec,d.act,d.next])(AE.txDecide({...base, track:'t2', cur:4, ctrl:[1,1,1,0], risk:[1]})), [4,'fix',5]);
t('poor adherence at Step 5: fix, not top', (d=>[d.rec,d.act,d.next])(AE.txDecide({...base, cur:5, ctrl:[1,1,'na',1], risk:[1]})), [5,'fix',null]);
t('other risk factor still steps up', tx({track:'t2', cur:3, ctrl:[1,1,1,0], risk:[7]}), [4,'up']);
t('child AIR ICS-formoterol → MART Step 3', (d=>[d.rec,d.notes.includes('aifMart')])(AE.txDecide({...base, age:'a611', track:null, cur:1, c1:'icsform', ctrl:[1,0,'na',0]})), [3,true]);
t('child AIR ICS+SABA → Step 2', tx({age:'a611', track:null, cur:1, c1:'other', ctrl:[1,0,0,0]}), [2,'consider']);
t('pregnant well 3 mo stays', (d=>[d.rec,d.act,d.notes])(AE.txDecide({...base, cur:4, ctrl:[0,0,'na',0], ctrlDur:'ge3', preg:true})), [4,'stay',['pregHold','preg']]);
t('pregnant uncontrolled may step up', tx({cur:3, ctrl:[1,1,'na',1], preg:true}), [4,'up']);
t('preg ignored outside ≥12', tx({age:'a611', track:null, cur:3, ctrl:[0,0,0,0], ctrlDur:'ge3', preg:true}), [2,'down']);
t('lowest step <3 mo: no step-down promise', AE.txDecide({...base, cur:2, ctrl:[0,0,'na',0]}).notes, ['lowest']);
t('lowest step with risk factor', AE.txDecide({...base, cur:2, ctrl:[0,0,'na',0], risk:[7]}).notes, ['lowestRisk']);
t('PRAM 2 alone → mild', ac([], 2), ['mild',false]);
t('PRAM 2 with moderate sign → moderate', ac([2], 2), ['mod',false]);
t('no PRAM, partial mild still moderate', ac([3]), ['mod',true]);

/* ---- teaching tabs ---- */
const tsrc = html.slice(html.indexOf('/*TEACH-START*/'), html.indexOf('/*TEACH-END*/'));
const tctx = { module: { exports: {} } };
vm.runInNewContext(tsrc, tctx);
const { CASES, QUIZ, MAP } = tctx.module.exports;
const signsSrc = html.slice(html.indexOf('const ACUTE_SIGNS='), html.indexOf('const SIGN_GROUPS='));
const SIGNS = vm.runInNewContext(signsSrc.replace('const ACUTE_SIGNS=', '(') .trim().replace(/;$/, '') + ')');
t('6 cases', CASES.length, 6);
t('20 questions', QUIZ.length, 20);
t('10 basic', QUIZ.filter(q => q.level === 'basic').length, 10);
t('10 advanced', QUIZ.filter(q => q.level === 'adv').length, 10);
t('answers evenly spread', [0,1,2,3].map(a => QUIZ.filter(q => q.ans === a).length), [5,5,5,5]);
t('unique quiz ids', new Set(QUIZ.map(q => q.id)).size, 20);
QUIZ.forEach(q => {
  t(q.id + ' has 4 distinct options', new Set(q.opts).size, 4);
  t(q.id + ' has why + source', !!(q.why && q.src && q.stem && q.topic), true);
});
t('correct option not longest in most', QUIZ.filter(q => q.opts[q.ans].length === Math.max(...q.opts.map(o => o.length))).length <= 5, true);
t('map has both sides', [MAP.dx.length >= 5, MAP.tx.length >= 5], [true, true]);
CASES.forEach(c => {
  t(c.id + ' has content', !!(c.title && c.story && c.ask && c.points.length && c.trap && c.src), true);
  t(c.id + ' load/expect align', c.load.length, c.expect.length);
  c.load.forEach((l, k) => {
    const w = l.wiz, e = c.expect[k];
    if (w.scenario === 'dx') t(`${c.id}.${k} dx`, AE.dxEval({ age: w.age, sx: w.sx, obj: w.obj, other: w.dxOther || [] }).key, e.key);
    else if (w.scenario === 'ac') t(`${c.id}.${k} acute`, AE.acuteClassify(SIGNS, w.acute, w.pram == null ? null : w.pram).key, e.key);
    else {
      const d = AE.txDecide({ age: w.age, cur: w.cur, track: w.track, init: w.init, ctrlDur: w.ctrlDur, ctrl: w.ctrl, risk: w.risk, c1: w.c1, preg: w.preg });
      t(`${c.id}.${k} tx`, [d.rec, d.act], [e.rec, e.act]);
      if (e.next) t(`${c.id}.${k} next`, d.next, e.next);
    }
  });
});
/* quiz answers that the engine can check */
const qOpt = id => QUIZ.find(q => q.id === id);
t('q1 engine: 2.00→2.22 negative', AE.dxEval({ age: 'ad18', sx: typ, obj: { pre: 2.0, post: 2.22 } }).objPos, false);
t('q1 key says negative', qOpt('q1').ans, 1);
t('q2 engine: well controlled', AE.ctrlLevel([0,0,0,0]).level, 'well');
t('q8 engine: RR >30 → severe', AE.acuteClassify(SIGNS, [2, 8, 10, 13, 14], null).key, 'sev');
t('q11 engine: child 10% predicted negative', AE.dxEval({ age: 'a611', sx: typ, obj: { pre: 1.5, post: 1.7, pred: 2.0 } }).objPos, false);
t('q15 engine: pregnant no step-down', AE.txDecide({ ...base, cur: 3, ctrl: [0,0,'na',0], ctrlDur: 'ge3', preg: true }).act, 'stay');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
