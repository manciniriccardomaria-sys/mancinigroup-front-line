import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function load(entryPoint, plugins = []) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, platform: 'node', format: 'esm', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const catalog = await load('src/pilotReportCatalog.ts');
const model = await load('src/negotiationModel.ts');

test('the detailed report has exactly four sections, unique counters and all agreed product variants', () => {
  assert.deepEqual(catalog.PILOT_REPORT_SECTIONS.map(section => section.title), ['Ricezione', 'Promozione', 'Emissione', 'Terzi']);
  const ids = catalog.PILOT_REPORT_CATEGORIES.map(category => category.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 31);
  for (const retired of ['prevRetailSe', 'emissRetailSe', 'prevRetailTerzi', 'winbackMag25', 'scegliAllianzGen26']) assert.equal(ids.includes(retired), false);
  const promotion = catalog.PILOT_REPORT_SECTIONS[1].categories.map(category => category.id);
  for (const id of ['vitarivConsegna', 'scegliAllianzConsegna', 'recensioni']) assert.equal(promotion.includes(id), true);
  for (const section of catalog.PILOT_REPORT_SECTIONS.slice(1)) {
    assert.deepEqual(section.categories.slice(0, 5).map(category => category.label), ['Motor', 'ULTRA Salute', 'SMEG', 'ULTRA Casa', 'ULTRA Impresa']);
  }
  for (const id of ['prevUltraSalute', 'prevUltraCasa', 'prevUltraImpresa', 'smeg']) assert.equal(model.isProposalCategory(id), true);
  for (const id of ['emissUltraSalute', 'emissProtection', 'prevUltraCasaTerzi', 'prevSmegTerzi']) assert.equal(model.isProposalCategory(id), false);
  const issuance = catalog.PILOT_REPORT_SECTIONS.find(section => section.id === 'issuance');
  const protectionIssuance = issuance.categories.find(category => category.id === 'emissProtection');
  assert.equal(protectionIssuance.label, 'Protection');
  assert.equal(protectionIssuance.activity, 'Contratti emessi');
  const thirdParty = catalog.PILOT_REPORT_SECTIONS.find(section => section.id === 'thirdParty');
  assert.deepEqual(thirdParty.categories.slice(-2).map(({ id, label }) => [id, label]), [
    ['sinistriMotorTerzi', 'Sinistri Motor'], ['sinistriRetailTerzi', 'Sinistri Retail'],
  ]);
});

test('Protection groups the two products while preserving their saved counters; Vitariv remains a separate customer activity', () => {
  const promotion = catalog.PILOT_REPORT_SECTIONS[1].categories;
  const protection = promotion.find(category => category.id === 'protection');
  assert.equal(protection.label, 'Protection');
  assert.deepEqual(protection.proposalOptions.map(category => [category.id, category.label]), [
    ['longevityCare', 'Longevity Care'], ['contattiProtection', 'Lovia'],
  ]);
  assert.equal(promotion.some(category => ['contattiProtection', 'longevityCare'].includes(category.id)), false);
  assert.equal(catalog.PILOT_REPORT_CATEGORIES.some(category => category.id === 'protection'), false);
  for (const option of protection.proposalOptions) assert.equal(model.isProposalCategory(option.id), true);
  const lovia = catalog.PILOT_REPORT_CATEGORIES.find(category => category.id === 'contattiProtection');
  assert.equal(lovia.label, 'Lovia');
  assert.equal(lovia.activity, 'Proposte presentate');
  assert.equal(lovia.group, 'Preventivi e proposte');
  assert.equal(model.isCustomerActivityCategory('vitarivConsegna'), true);
  assert.equal(model.isProposalCategory('vitarivConsegna'), false);
  assert.equal(model.isCustomerActivityCategory('scegliAllianzGen26'), false);
  assert.equal(model.isCustomerActivityCategory('scegliAllianzConsegna'), false);
});
