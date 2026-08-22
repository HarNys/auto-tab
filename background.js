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

const updateGroupTitle = (groupId) => {
  if (groupId === null || groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }
  
  chrome.tabs.query({ groupId: groupId }, (tabs) => {
    if (chrome.runtime.lastError || tabs.length === 0) return;

    let hostname = 'Group';
    try {
      const counts = {};
      tabs.forEach(t => {
        if (t.url) {
          try {
            const h = formatHostname(new URL(t.url).hostname);
            counts[h] = (counts[h] || 0) + 1;
          } catch (e) {}
        }
      });
      const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (sorted.length > 0) hostname = sorted[0];
    } catch (e) {}

    const newTitle = `${hostname} [${tabs.length}]`;
    chrome.tabGroups.update(groupId, { title: newTitle });
  });
};

const groupAllTabs = () => {
  chrome.storage.sync.get('autoGroupingEnabled', (data) => {
    if (data.autoGroupingEnabled === false) return;
    
    chrome.tabs.query({ windowType: 'normal' }, (tabs) => {
      if (tabs.length === 0) return;
      const tabsByHostname = {};
      tabs.forEach(tab => {
        if (tab.url) {
          try {
            const formatted = formatHostname(new URL(tab.url).hostname);
            if (!tabsByHostname[formatted]) tabsByHostname[formatted] = [];
            tabsByHostname[formatted].push(tab.id);
          } catch (e) {}
        }
      });

      chrome.tabGroups.query({ windowId: tabs[0].windowId }, (existingGroups) => {
        for (const formattedHostname in tabsByHostname) {
          const tabIds = tabsByHostname[formattedHostname];
          const group = existingGroups.find(g => g.title.startsWith(formattedHostname));
          if (group) {
            chrome.tabs.group({ groupId: group.id, tabIds }, () => updateGroupTitle(group.id));
          } else {
            chrome.tabs.group({ tabIds }, (groupId) => {
              // Initial color set can help with visibility, but updateGroupTitle handles the name
              chrome.tabGroups.update(groupId, { color: 'grey' }, () => updateGroupTitle(groupId));
            });
          }
        }
      });
    });
  });
};

chrome.runtime.onInstalled.addListener(groupAllTabs);
chrome.windows.onCreated.addListener(groupAllTabs);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  chrome.storage.sync.get('autoGroupingEnabled', (data) => {
    if (data.autoGroupingEnabled === false || changeInfo.status !== 'complete' || !tab.url) {
      return;
    }

    let formattedHostname;
    try {
      formattedHostname = formatHostname(new URL(tab.url).hostname);
    } catch (e) {
      return;
    }

    chrome.tabGroups.query({ windowId: tab.windowId }, (allGroups) => {
      const groupForHostname = allGroups.find(g => g.title.startsWith(formattedHostname));
      
      if (groupForHostname) {
        if (tab.groupId !== groupForHostname.id) {
          chrome.tabs.group({ groupId: groupForHostname.id, tabIds: tabId }, () => {
             updateGroupTitle(groupForHostname.id);
          });
        } else {
          updateGroupTitle(tab.groupId);
        }
      } else {
        chrome.tabs.group({ tabIds: [tabId] }, (newGroupId) => {
          // Setting the initial color then delegating to updateGroupTitle for the name/delay
          chrome.tabGroups.update(newGroupId, { color: 'blue' }, () => updateGroupTitle(newGroupId));
        });
      }
    });
  });
});

const updateAllGroupTitles = () => {
    chrome.tabGroups.query({}, (groups) => {
        for(const group of groups) {
            updateGroupTitle(group.id);
        }
    });
};

chrome.tabs.onAttached.addListener(updateAllGroupTitles);
chrome.tabs.onDetached.addListener(updateAllGroupTitles);

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (!removeInfo.isWindowClosing) {
        updateAllGroupTitles();
    }
});
