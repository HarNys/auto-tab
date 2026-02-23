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
  // Check if groupId is valid
  if (groupId === null || groupId === undefined || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    return;
  }
  chrome.tabGroups.get(groupId, (group) => {
    if (chrome.runtime.lastError || !group) { return; }
    chrome.tabs.query({ groupId: groupId }, (tabs) => {
      // If the group is empty, it will be removed automatically. No need to update.
      if (tabs.length === 0) { return; } 
      
      let baseTitle = group.title.split(' ')[0];
      
      // Fallback if the title is empty or missing the hostname
      if (!baseTitle && tabs[0].url) {
        try {
          baseTitle = formatHostname(new URL(tabs[0].url).hostname);
        } catch (e) {
          baseTitle = 'Group';
        }
      }

      const newTitle = `${baseTitle} [${tabs.length}]`;
      if (group.title !== newTitle) {
        // Including the color in the update can sometimes help force a UI refresh in Chrome
        chrome.tabGroups.update(groupId, { 
          title: newTitle,
          color: group.color 
        });
      }
    });
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
              const newTitle = `${formattedHostname} [${tabIds.length}]`;
              // Including a color helps force a UI refresh for the group title
              chrome.tabGroups.update(groupId, { title: newTitle, color: 'grey' });
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
          const newTitle = `${formattedHostname} [1]`;
          // Including a color helps force a UI refresh for the group title
          chrome.tabGroups.update(newGroupId, { title: newTitle, color: 'blue' });
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
