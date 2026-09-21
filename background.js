const formatHostname = (hostname) => {
  let domain = hostname;
  if (domain.startsWith('www.')) {
    domain = domain.substring(4);
  }
  const parts = domain.split('.');
  if (parts.length > 2) {
    domain = parts[parts.length - 2];
  } else if (parts.length > 1) {
    domain = parts[0];
  }
  return domain.charAt(0).toUpperCase() + domain.slice(1);
};

// Returns the group name for a tab, or null if the tab must not be grouped
// (non-web URLs, pinned tabs, or tabs without a hostname).
const getGroupName = (tab) => {
  if (!tab.url || tab.pinned) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const name = formatHostname(url.hostname);
    return name || null;
  } catch (e) {
    return null;
  }
};

// Group titles look like "Name [3]"; extracts "Name".
const groupName = (title) => {
  const match = /^(.*) \[\d+\]$/.exec(title || '');
  return match ? match[1] : null;
};

// Tab groups only exist in normal windows. Popups (e.g. OAuth login windows)
// must never be touched: grouping them crashes the browser process.
const isNormalWindow = async (windowId) => {
  try {
    const win = await chrome.windows.get(windowId);
    return win.type === 'normal';
  } catch (e) {
    return false;
  }
};

// All grouping work runs through one queue so concurrent tab events can't
// race each other into creating duplicate groups.
let queue = Promise.resolve();
const enqueue = (task) => {
  queue = queue.then(task).catch(() => {});
  return queue;
};

const isEnabled = async () => {
  const data = await chrome.storage.sync.get('autoGroupingEnabled');
  return data.autoGroupingEnabled !== false;
};

const updateGroupTitle = async (groupId) => {
  if (groupId === null || groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }

  const tabs = await chrome.tabs.query({ groupId });
  if (tabs.length === 0) return;

  const counts = {};
  tabs.forEach(t => {
    const name = getGroupName(t);
    if (name) counts[name] = (counts[name] || 0) + 1;
  });
  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const hostname = sorted.length > 0 ? sorted[0] : 'Group';

  const newTitle = `${hostname} [${tabs.length}]`;
  const group = await chrome.tabGroups.get(groupId);
  if (group.title !== newTitle) {
    await chrome.tabGroups.update(groupId, { title: newTitle });
  }
};

const updateAllGroupTitles = () => enqueue(async () => {
  const groups = await chrome.tabGroups.query({});
  for (const group of groups) {
    await updateGroupTitle(group.id);
  }
});

// Moves the given tabs into the group named `name` in their window, creating it if needed.
const groupTabs = async (windowId, name, tabIds) => {
  const groups = await chrome.tabGroups.query({ windowId });
  const existing = groups.find(g => groupName(g.title) === name);
  let groupId;
  if (existing) {
    groupId = await chrome.tabs.group({ groupId: existing.id, tabIds });
  } else {
    groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { color: 'grey', title: `${name} [${tabIds.length}]` });
  }
  await updateGroupTitle(groupId);
};

const groupAllTabs = () => enqueue(async () => {
  if (!(await isEnabled())) return;

  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  for (const win of windows) {
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const tabsByName = {};
    tabs.forEach(tab => {
      const name = getGroupName(tab);
      if (!name) return;
      (tabsByName[name] = tabsByName[name] || []).push(tab.id);
    });

    for (const name in tabsByName) {
      await groupTabs(win.id, name, tabsByName[name]);
    }
  }
});

chrome.runtime.onInstalled.addListener(groupAllTabs);
chrome.windows.onCreated.addListener(groupAllTabs);

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;

  enqueue(async () => {
    if (!(await isEnabled())) return;

    // The tab may have changed or closed while queued, so fetch its current state.
    const tab = await chrome.tabs.get(tabId);
    const name = getGroupName(tab);
    if (!name || !(await isNormalWindow(tab.windowId))) return;

    await groupTabs(tab.windowId, name, [tabId]);
  });
});

chrome.tabs.onAttached.addListener(updateAllGroupTitles);
chrome.tabs.onDetached.addListener(updateAllGroupTitles);

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo.isWindowClosing) {
    updateAllGroupTitles();
  }
});
