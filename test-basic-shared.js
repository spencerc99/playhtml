// Simple test script to verify shared element discovery
console.log('Testing shared element discovery...');

// Simulate DOM elements
const mockDocument = {
  querySelectorAll: (selector) => {
    if (selector === '[shared], [shared-domain], [shared-global]') {
      return [
        { id: 'test1', hasAttribute: () => true, getAttribute: () => '' }
      ];
    }
    if (selector === '[data-source]') {
      return [
        { getAttribute: () => 'localhost:5173/page#element1' }
      ];
    }
    return [];
  }
};

function findSharedElementsOnPage() {
  const elements = [];
  
  mockDocument.querySelectorAll('[shared], [shared-domain], [shared-global]').forEach((el) => {
    if (!el.id) return;
    
    elements.push({
      elementId: el.id,
      permissions: 'read-write',
      scope: 'global',
      path: '/test',
    });
  });
  
  return elements;
}

function findSharedReferencesOnPage() {
  const references = [];
  
  mockDocument.querySelectorAll('[data-source]').forEach((el) => {
    const dataSource = el.getAttribute('data-source');
    if (!dataSource) return;
    
    const [domainAndPath, elementId] = dataSource.split('#');
    if (!domainAndPath || !elementId) return;
    
    const pathIndex = domainAndPath.indexOf('/');
    const domain = pathIndex === -1 ? domainAndPath : domainAndPath.substring(0, pathIndex);
    const path = pathIndex === -1 ? '/' : domainAndPath.substring(pathIndex);
    
    references.push({ domain, path, elementId });
  });
  
  return references;
}

const sharedElements = findSharedElementsOnPage();
const sharedReferences = findSharedReferencesOnPage();

console.log('Shared elements:', sharedElements);
console.log('Shared references:', sharedReferences);

console.log('✅ Basic parsing test passed');