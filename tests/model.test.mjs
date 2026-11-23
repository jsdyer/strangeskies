import test from 'node:test';
import assert from 'node:assert/strict';
import {terms,matcher} from '../web/search.mjs';
const row=['2026T0001','2026-01-01','Montréal','CYUL','Airport','Quebec','Canada','Incident','','',null,null,'','','','','',[],[['Bird strike','Collision avec un oiseau']],[],[]];
test('accent-insensitive and quoted phrases match bilingual records',()=>{assert.deepEqual(terms('"bird strike" Montréal'),['bird strike','montreal']);assert.equal(matcher({q:'montreal "bird strike"'})(row),true);});
test('region and event filters require exact source values',()=>{assert.equal(matcher({q:'',region:'BC'})(row),false);assert.equal(matcher({q:'',event:'Bird strike'})(row),true);assert.equal(matcher({q:'',event:'Unrelated'})(row),false);});
