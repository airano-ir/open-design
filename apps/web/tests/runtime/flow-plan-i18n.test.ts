import { describe, expect, it } from 'vitest';

import { ar } from '../../src/i18n/locales/ar';
import { de } from '../../src/i18n/locales/de';
import { en } from '../../src/i18n/locales/en';
import { esES } from '../../src/i18n/locales/es-ES';
import { fa } from '../../src/i18n/locales/fa';
import { fr } from '../../src/i18n/locales/fr';
import { hu } from '../../src/i18n/locales/hu';
import { id } from '../../src/i18n/locales/id';
import { it as italian } from '../../src/i18n/locales/it';
import { ja } from '../../src/i18n/locales/ja';
import { ko } from '../../src/i18n/locales/ko';
import { pl } from '../../src/i18n/locales/pl';
import { ptBR } from '../../src/i18n/locales/pt-BR';
import { ru } from '../../src/i18n/locales/ru';
import { th } from '../../src/i18n/locales/th';
import { tr } from '../../src/i18n/locales/tr';
import { uk } from '../../src/i18n/locales/uk';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { zhTW } from '../../src/i18n/locales/zh-TW';
import { LOCALES, type Dict } from '../../src/i18n/types';

const DICTIONARIES: readonly Dict[] = [
  ar,
  de,
  en,
  esES,
  fa,
  fr,
  hu,
  id,
  italian,
  ja,
  ko,
  pl,
  ptBR,
  ru,
  th,
  tr,
  uk,
  zhCN,
  zhTW,
];

const PLAN_KEYS = [
  'flow.plan.unit.slide',
  'flow.plan.unit.view',
  'flow.plan.unit.section',
  'flow.plan.unit.screen',
  'flow.plan.unit.page',
  'flow.plan.unit.chapter',
  'flow.plan.unit.asset',
  'flow.plan.titleLabel',
  'flow.plan.pointsLabel',
  'flow.plan.pointsHint',
  'flow.plan.untitled',
  'flow.plan.add',
  'flow.plan.insert',
  'flow.plan.moveUp',
  'flow.plan.moveDown',
  'flow.plan.empty',
  'flow.plan.saveError',
] as const satisfies readonly (keyof Dict)[];

const UNIT_TEMPLATE_KEYS = [
  'flow.plan.titleLabel',
  'flow.plan.untitled',
  'flow.plan.add',
  'flow.plan.insert',
  'flow.plan.empty',
] as const satisfies readonly (keyof Dict)[];

const INSPIRE_KEYS = [
  'flow.inspire.searchPlaceholder',
  'flow.inspire.categoriesLabel',
  'flow.inspire.empty',
  'flow.inspire.rank',
  'flow.inspire.select',
  'flow.inspire.apply',
  'flow.inspire.skip',
] as const satisfies readonly (keyof Dict)[];

describe('staged-flow workspace localization', () => {
  it('defines the complete plan and inspiration copy in every supported locale', () => {
    expect(DICTIONARIES).toHaveLength(LOCALES.length);

    for (const dictionary of DICTIONARIES) {
      for (const key of [...PLAN_KEYS, ...INSPIRE_KEYS]) {
        expect(dictionary[key].trim(), key).not.toBe('');
      }
      for (const key of UNIT_TEMPLATE_KEYS) {
        expect(dictionary[key], key).toContain('{unit}');
      }
    }
  });

  it('ships translated Simplified Chinese plan actions', () => {
    const dictionary = DICTIONARIES.find(
      (candidate) => candidate['flow.title'] === '任务进度',
    );
    expect(dictionary).toBeDefined();
    if (!dictionary) throw new Error('Simplified Chinese dictionary is missing');

    expect(
      dictionary['flow.plan.add'].replace(
        '{unit}',
        dictionary['flow.plan.unit.screen'],
      ),
    ).toBe('添加屏幕');
    expect(dictionary['flow.plan.pointsLabel']).toBe('关键要点');
    expect(dictionary['flow.plan.saveError']).toBe('无法保存编辑后的方案');
    expect(dictionary['flow.inspire.apply']).toBe('使用此风格');
    expect(dictionary['flow.inspire.skip']).toBe('使用默认风格');
  });
});
