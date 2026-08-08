import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage } from '../src/input/language.js';

test('detects japanese by kana', () => {
  assert.equal(detectLanguage('この製品は1.5kgです'), 'ja');
});

test('detects korean by hangul', () => {
  assert.equal(detectLanguage('이 제품의 무게는 1.5kg'), 'ko');
});

test('detects chinese by han', () => {
  assert.equal(detectLanguage('该设备重量为1.5公斤'), 'zh');
});

test('detects russian by cyrillic text', () => {
  assert.equal(detectLanguage('Вес устройства 1,5 кг'), 'ru');
});

test('detects greek script', () => {
  assert.equal(detectLanguage('Το βάρος είναι 1,5 κιλά'), 'el');
});

test('detects german', () => {
  assert.equal(detectLanguage('Das Gerät wiegt 1,5 kg und ist mit 8 GB RAM ausgestattet.'), 'de');
});

test('detects french', () => {
  assert.equal(detectLanguage("Le poids de l'appareil est de 1,5 kg."), 'fr');
});

test('detects spanish', () => {
  assert.equal(detectLanguage('El peso del dispositivo es de 1,5 kg.'), 'es');
});

test('detects english', () => {
  assert.equal(detectLanguage('The device weighs 1.5 kg and has 8 GB RAM.'), 'en');
});

test('returns undefined for empty text', () => {
  assert.equal(detectLanguage(''), undefined);
});
