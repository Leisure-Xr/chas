'use strict';

const { normalizePublicUrl } = require('./reader-history');

const MAX_FOLDERS = 30;
const MAX_ITEMS_PER_FOLDER = 100;
const MAX_TOTAL_ITEMS = 300;
const MAX_FOLDER_NAME_LENGTH = 50;
const MAX_TITLE_LENGTH = 200;

function normalizeFavoriteFolders(value) {
  const result = [];
  let totalItems = 0;
  for (const rawFolder of Array.isArray(value) ? value : []) {
    const folder = normalizeFolder(rawFolder);
    if (!folder || result.some((entry) => entry.id === folder.id || sameName(entry.name, folder.name))) continue;
    const items = [];
    for (const rawItem of folder.items) {
      const item = normalizeFavorite(rawItem);
      if (!item || items.some((entry) => entry.url === item.url) || totalItems >= MAX_TOTAL_ITEMS) continue;
      items.push(item);
      totalItems += 1;
      if (items.length >= MAX_ITEMS_PER_FOLDER) break;
    }
    result.push({ ...folder, items });
    if (result.length >= MAX_FOLDERS) break;
  }
  return result;
}

function createFavoriteFolder(current, rawName, rawId, createdAt = Date.now()) {
  const folders = normalizeFavoriteFolders(current);
  const name = validateFolderName(rawName);
  const id = String(rawId || '').trim();
  const timestamp = Number(createdAt);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !Number.isInteger(timestamp) || timestamp <= 0) {
    throw new Error('收藏目录标识无效。');
  }
  if (folders.length >= MAX_FOLDERS) throw new Error(`最多创建 ${MAX_FOLDERS} 个收藏目录。`);
  if (folders.some((folder) => folder.id === id || sameName(folder.name, name))) throw new Error('收藏目录名称已存在。');
  return [...folders, { id, name, createdAt: timestamp, items: [] }];
}

function renameFavoriteFolder(current, folderId, rawName) {
  const folders = normalizeFavoriteFolders(current);
  const name = validateFolderName(rawName);
  if (folders.some((folder) => folder.id !== folderId && sameName(folder.name, name))) {
    throw new Error('收藏目录名称已存在。');
  }
  let found = false;
  const result = folders.map((folder) => {
    if (folder.id !== folderId) return folder;
    found = true;
    return { ...folder, name };
  });
  if (!found) throw new Error('收藏目录不存在。');
  return result;
}

function deleteFavoriteFolder(current, folderId) {
  const folders = normalizeFavoriteFolders(current);
  const result = folders.filter((folder) => folder.id !== folderId);
  if (result.length === folders.length) throw new Error('收藏目录不存在。');
  return result;
}

function addFavorite(current, folderId, rawFavorite, savedAt = Date.now()) {
  const folders = normalizeFavoriteFolders(current);
  const favorite = normalizeFavorite({ ...rawFavorite, savedAt });
  if (!favorite) throw new Error('只能收藏公开的 LINUX DO 主题。');
  const totalItems = folders.reduce((count, folder) => count + folder.items.length, 0);
  let found = false;
  const result = folders.map((folder) => {
    if (folder.id !== folderId) return folder;
    found = true;
    const withoutDuplicate = folder.items.filter((item) => item.url !== favorite.url);
    if (withoutDuplicate.length >= MAX_ITEMS_PER_FOLDER) throw new Error(`每个目录最多收藏 ${MAX_ITEMS_PER_FOLDER} 个主题。`);
    if (withoutDuplicate.length === folder.items.length && totalItems >= MAX_TOTAL_ITEMS) {
      throw new Error(`收藏夹最多保存 ${MAX_TOTAL_ITEMS} 个主题。`);
    }
    return { ...folder, items: [favorite, ...withoutDuplicate] };
  });
  if (!found) throw new Error('收藏目录不存在。');
  return result;
}

function removeFavorite(current, folderId, rawUrl) {
  const folders = normalizeFavoriteFolders(current);
  const url = normalizePublicUrl(rawUrl);
  let found = false;
  const result = folders.map((folder) => {
    if (folder.id !== folderId) return folder;
    found = true;
    return { ...folder, items: folder.items.filter((item) => item.url !== url) };
  });
  if (!found) throw new Error('收藏目录不存在。');
  return result;
}

function normalizeFolder(value) {
  if (!value || typeof value !== 'object') return undefined;
  const id = String(value.id || '').trim();
  const name = normalizeFolderName(value.name);
  const createdAt = Number(value.createdAt);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !name || !Number.isInteger(createdAt) || createdAt <= 0) return undefined;
  return { id, name, createdAt, items: Array.isArray(value.items) ? value.items : [] };
}

function normalizeFavorite(value) {
  if (!value || typeof value !== 'object') return undefined;
  const url = normalizePublicUrl(value.url);
  const savedAt = Number(value.savedAt);
  if (!url || !/^https:\/\/linux\.do\/t\//.test(url) || !Number.isInteger(savedAt) || savedAt <= 0) return undefined;
  return { url, title: normalizeTitle(value.title), savedAt };
}

function validateFolderName(value) {
  const name = normalizeFolderName(value);
  if (!name) throw new Error('目录名称不能为空。');
  return name;
}

function normalizeFolderName(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_FOLDER_NAME_LENGTH);
}

function normalizeTitle(value) {
  const title = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (title || 'LINUX DO 公开主题').slice(0, MAX_TITLE_LENGTH);
}

function sameName(left, right) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

module.exports = {
  MAX_FOLDERS,
  MAX_ITEMS_PER_FOLDER,
  MAX_TOTAL_ITEMS,
  addFavorite,
  createFavoriteFolder,
  deleteFavoriteFolder,
  normalizeFavoriteFolders,
  removeFavorite,
  renameFavoriteFolder
};
