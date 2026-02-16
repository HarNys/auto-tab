document.addEventListener('DOMContentLoaded', () => {
  const autoGroupCheckbox = document.getElementById('autoGroupCheckbox');

  // Load the saved state
  chrome.storage.sync.get('autoGroupingEnabled', (data) => {
    autoGroupCheckbox.checked = data.autoGroupingEnabled !== false;
  });

  // Save the state when the checkbox is clicked
  autoGroupCheckbox.addEventListener('change', () => {
    chrome.storage.sync.set({ autoGroupingEnabled: autoGroupCheckbox.checked });
  });
});
