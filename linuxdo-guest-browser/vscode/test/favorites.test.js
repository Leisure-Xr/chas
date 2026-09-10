'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  addFavorite,
  createFavoriteFolder,
  deleteFavoriteFolder,
  normalizeFavoriteFolders,
  removeFavorite,
  renameFavoriteFolder
} = require('../src/favorites');

test('folders can be created, renamed and deleted', () => {
  let folders = createFavoriteFolder([], ' 技术  资料 ', 'folder-1', 1000);
  assert.equal(folders[0].name, '技术 资料');
  folders = renameFavoriteFolder(folders, 'folder-1', '稍后阅读');
  assert.equal(folders[0].name, '稍后阅读');
  assert.deepEqual(deleteFavoriteFolder(folders, 'folder-1'), []);
});

test('folder names are unique and damaged folders are discarded', () => {
  const folders = createFavoriteFolder([], '技术', 'folder-1', 1000);
  assert.throws(() => createFavoriteFolder(folders, '技术', 'folder-2', 2000), /已存在/);
  assert.deepEqual(normalizeFavoriteFolders([{ id: '../bad', name: 'Bad', createdAt: 1 }]), []);
});

test('favorites store only normalized public topics and deduplicate per folder', () => {
  let folders = createFavoriteFolder([], '技术', 'folder-1', 1000);
  folders = addFavorite(folders, 'folder-1', {
    url: 'https://linux.do/t/example/123/4?x=1#post_4', title: ' First\nTitle '
  }, 2000);
  folders = addFavorite(folders, 'folder-1', {
    url: 'https://linux.do/t/example/123', title: 'Updated title'
  }, 3000);
  assert.deepEqual(folders[0].items, [{
    url: 'https://linux.do/t/example/123', title: 'Updated title', savedAt: 3000
  }]);
  assert.throws(() => addFavorite(folders, 'folder-1', { url: 'https://example.com/t/1', title: 'Offsite' }, 4000), /公开/);
});

test('the same topic may be organized into different folders', () => {
  let folders = createFavoriteFolder([], 'A', 'folder-a', 1000);
  folders = createFavoriteFolder(folders, 'B', 'folder-b', 2000);
  const topic = { url: 'https://linux.do/t/topic/1', title: 'Topic' };
  folders = addFavorite(folders, 'folder-a', topic, 3000);
  folders = addFavorite(folders, 'folder-b', topic, 4000);
  assert.equal(folders[0].items.length, 1);
  assert.equal(folders[1].items.length, 1);
  folders = removeFavorite(folders, 'folder-a', topic.url);
  assert.equal(folders[0].items.length, 0);
  assert.equal(folders[1].items.length, 1);
});
