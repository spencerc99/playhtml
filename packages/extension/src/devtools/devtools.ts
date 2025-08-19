import browser from 'webextension-polyfill'

// Create PlayHTML panel in DevTools
browser.devtools.panels.create(
  'PlayHTML',
  'icons/icon-16.png',
  'src/devtools/panel.html'
).then((panel) => {
  console.log('PlayHTML DevTools panel created')
})

export {}