export const IPC = {
  file: {
    openDialog: "file:openDialog",
    ref: "file:ref",
    readBytes: "file:readBytes",
    readText: "file:readText",
    writeText: "file:writeText",
    revealInExplorer: "file:revealInExplorer",
    openExternal: "file:openExternal",
    watch: "file:watch",
    unwatch: "file:unwatch",
    changed: "file:changed"
  },
  doc: {
    extract: "doc:extract"
  },
  annotations: {
    list: "annotations:list",
    add: "annotations:add",
    update: "annotations:update",
    remove: "annotations:remove"
  },
  rag: {
    index: "rag:index",
    status: "rag:status",
    remove: "rag:remove",
    query: "rag:query",
    search: "rag:search",
    themes: "rag:themes",
    buildThemes: "rag:buildThemes",
    progress: "rag:progress"
  },
  llm: {
    chatStream: "llm:chatStream",
    abort: "llm:abort",
    models: "llm:models",
    token: "llm:token",
    done: "llm:done",
    error: "llm:error"
  },
  providers: {
    list: "providers:list",
    detectLocal: "providers:detectLocal",
    test: "providers:test",
    modules: "providers:modules"
  },
  threads: {
    save: "threads:save",
    load: "threads:load",
    list: "threads:list",
    remove: "threads:remove",
    export: "threads:export"
  },
  settings: {
    get: "settings:get",
    set: "settings:set",
    setSecret: "settings:setSecret",
    clearSecret: "settings:clearSecret"
  },
  health: {
    check: "health:check"
  },
  onboarding: {
    status: "onboarding:status",
    complete: "onboarding:complete"
  },
  update: {
    check: "update:check",
    install: "update:install"
  },
  flashcards: {
    decksList: "flashcards:decks:list",
    decksCreate: "flashcards:decks:create",
    decksRename: "flashcards:decks:rename",
    decksRemove: "flashcards:decks:remove",
    cardsList: "flashcards:cards:list",
    cardsAdd: "flashcards:cards:add",
    cardsUpdate: "flashcards:cards:update",
    cardsRemove: "flashcards:cards:remove",
    cardsReview: "flashcards:cards:review",
    generate: "flashcards:generate",
    exportAnki: "flashcards:exportAnki"
  },
  browser: {
    open: "browser:open",
    navigate: "browser:navigate",
    back: "browser:back",
    forward: "browser:forward",
    reload: "browser:reload",
    stop: "browser:stop",
    home: "browser:home",
    setBounds: "browser:setBounds",
    setVisible: "browser:setVisible",
    current: "browser:current",
    state: "browser:state",
    selection: "browser:selection",
    saveRequest: "browser:saveRequest"
  },
  links: {
    graph: "links:graph",
    conceptsCreate: "links:concepts:create",
    conceptsUpdate: "links:concepts:update",
    conceptsMerge: "links:concepts:merge",
    conceptsRemove: "links:concepts:remove",
    link: "links:link",
    unlink: "links:unlink",
    passagesRemove: "links:passages:remove",
    relocate: "links:relocate",
    proposalsList: "links:proposals:list",
    proposalsUpdate: "links:proposals:update",
    proposalsAccept: "links:proposals:accept",
    proposalsReject: "links:proposals:reject",
    proposalsMerge: "links:proposals:merge",
    extract: "links:extract",
    extractCancel: "links:extract:cancel",
    extractStatus: "links:extract:status",
    changed: "links:changed",
    extractProgress: "links:extractProgress"
  },
  workspace: {
    bookmarksList: "workspace:bookmarks:list",
    bookmarksAdd: "workspace:bookmarks:add",
    bookmarksRemove: "workspace:bookmarks:remove",
    sessionGet: "workspace:session:get",
    sessionSet: "workspace:session:set",
    recentList: "workspace:recent:list",
    recentRemove: "workspace:recent:remove",
    recentClear: "workspace:recent:clear"
  },
  library: {
    state: "library:state",
    recent: "library:recent",
    forgetRecent: "library:forgetRecent",
    pickFolder: "library:pickFolder",
    create: "library:create",
    open: "library:open",
    files: "library:files",
    rescan: "library:rescan",
    import: "library:import",
    importDialog: "library:importDialog",
    reveal: "library:reveal",
    outsideWithData: "library:outsideWithData",
    migrationPlan: "library:migration:plan",
    migrationRun: "library:migration:run",
    findText: "library:findText",
    changed: "library:changed",
    findProgress: "library:findProgress"
  }
} as const;
