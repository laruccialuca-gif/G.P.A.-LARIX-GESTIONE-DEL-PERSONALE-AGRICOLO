const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  appRuntime: {
    getInfo: () => ipcRenderer.invoke('appRuntime:getInfo'),
    getAvailableYears: () => ipcRenderer.invoke('appRuntime:getAvailableYears'),
  },

  demo: {
    markWelcomeSeen: () => ipcRenderer.invoke('demo:markWelcomeSeen'),
    reset: () => ipcRenderer.invoke('demo:reset'),
  },

  dashboard: {
    summary: () => ipcRenderer.invoke('dashboard:summary'),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (payload) => ipcRenderer.invoke('settings:save', payload),
    unlockAdmin: (pin) => ipcRenderer.invoke('settings:unlockAdmin', pin),
    setRole: (role) => ipcRenderer.invoke('settings:setRole', role),
    chooseBackupDirectory: () => ipcRenderer.invoke('settings:chooseBackupDirectory'),
    uploadLogo: () => ipcRenderer.invoke('settings:uploadLogo'),
    chooseLogoFile: () => ipcRenderer.invoke('settings:chooseLogoFile'),
    uploadMarkerAsset: () => ipcRenderer.invoke('settings:uploadMarkerAsset'),
    removeLogo: () => ipcRenderer.invoke('settings:removeLogo'),
  },

  license: {
    getStatus: () => ipcRenderer.invoke('license:getStatus'),
    activate: (activationCode) => ipcRenderer.invoke('license:activate', activationCode),
    deactivate: () => ipcRenderer.invoke('license:deactivate'),
    getActivationRequest: () => ipcRenderer.invoke('license:getActivationRequest'),
  },

  backups: {
    list: () => ipcRenderer.invoke('backups:list'),
    create: (type) => ipcRenderer.invoke('backups:create', type),
    chooseRestore: () => ipcRenderer.invoke('backups:chooseRestore'),
    restore: (backupDir) => ipcRenderer.invoke('backups:restore', backupDir),
  },

  employees: {
    list: (options) => ipcRenderer.invoke('employees:list', options),
    getById: (id, options) => ipcRenderer.invoke('employees:getById', id, options),
    findHistoryMatches: (criteria) => ipcRenderer.invoke('employees:findHistoryMatches', criteria),
    create: (payload) => ipcRenderer.invoke('employees:create', payload),
    update: (id, payload) => ipcRenderer.invoke('employees:update', id, payload),
    archive: (id) => ipcRenderer.invoke('employees:archive', id),
    restore: (id) => ipcRenderer.invoke('employees:restore', id),
    deletePermanently: (id) => ipcRenderer.invoke('employees:deletePermanently', id),
    parsePdfImport: (options) => ipcRenderer.invoke('employees:parsePdfImport', options),
    confirmPdfImport: (payload) => ipcRenderer.invoke('employees:confirmPdfImport', payload),
    uploadHireDocument: (employeeId) => ipcRenderer.invoke('employees:uploadHireDocument', employeeId),
    uploadHireDocumentForPeriod: (employeeId, employmentPeriodId) =>
      ipcRenderer.invoke('employees:uploadHireDocumentForPeriod', employeeId, employmentPeriodId),
    openHireDocument: (employeeId) => ipcRenderer.invoke('employees:openHireDocument', employeeId),
    openHireDocumentForPeriod: (employeeId, employmentPeriodId) =>
      ipcRenderer.invoke('employees:openHireDocumentForPeriod', employeeId, employmentPeriodId),
    deleteHireDocument: (employeeId) => ipcRenderer.invoke('employees:deleteHireDocument', employeeId),
    deleteHireDocumentForPeriod: (employeeId, employmentPeriodId) =>
      ipcRenderer.invoke('employees:deleteHireDocumentForPeriod', employeeId, employmentPeriodId),
    uploadArt37Document: (employeeId) => ipcRenderer.invoke('employees:uploadArt37Document', employeeId),
    openArt37Document: (employeeId) => ipcRenderer.invoke('employees:openArt37Document', employeeId),
    deleteArt37Document: (employeeId) => ipcRenderer.invoke('employees:deleteArt37Document', employeeId),
    uploadMedicalVisitDocument: (employeeId) => ipcRenderer.invoke('employees:uploadMedicalVisitDocument', employeeId),
    openMedicalVisitDocument: (employeeId) => ipcRenderer.invoke('employees:openMedicalVisitDocument', employeeId),
    deleteMedicalVisitDocument: (employeeId) => ipcRenderer.invoke('employees:deleteMedicalVisitDocument', employeeId),
  },

  occupations: {
    list: () => ipcRenderer.invoke('occupations:list'),
    create: (name) => ipcRenderer.invoke('occupations:create', name),
  },

  teams: {
    list: (options) => ipcRenderer.invoke('teams:list', options),
    getById: (id, options) => ipcRenderer.invoke('teams:getById', id, options),
    create: (payload) => ipcRenderer.invoke('teams:create', payload),
    update: (id, payload) => ipcRenderer.invoke('teams:update', id, payload),
    archive: (id) => ipcRenderer.invoke('teams:archive', id),
    restore: (id) => ipcRenderer.invoke('teams:restore', id),
    deletePermanently: (id) => ipcRenderer.invoke('teams:deletePermanently', id),
  },

  communications: {
    list: () => ipcRenderer.invoke('communications:list'),
    save: (payload) => ipcRenderer.invoke('communications:save', payload),
    delete: (id) => ipcRenderer.invoke('communications:delete', id),
    openFile: (id, type) => ipcRenderer.invoke('communications:openFile', id, type),
    sendEmail: (id, options) => ipcRenderer.invoke('communications:sendEmail', id, options),
  },

  attendance: {
    save: (payload) => ipcRenderer.invoke('attendance:save', payload),
    bulkUpsert: (payload) => ipcRenderer.invoke('attendance:bulkUpsert', payload),
    listByMonth: (year, month) => ipcRenderer.invoke('attendance:listByMonth', year, month),
    monthlySummary: (month) => ipcRenderer.invoke('attendance:monthlySummary', month),
    getMatrix: (month) => ipcRenderer.invoke('attendance:getMatrix', month),
  },

  payroll: {
    saveRecord: (payload) => ipcRenderer.invoke('payroll:saveRecord', payload),
    listByEmployee: (employeeId) => ipcRenderer.invoke('payroll:listByEmployee', employeeId),
    listHistory: () => ipcRenderer.invoke('payroll:listHistory'),
    getRecord: (employeeId, month) => ipcRenderer.invoke('payroll:getRecord', employeeId, month),
    getPreviousBalance: (employeeId, month) =>
      ipcRenderer.invoke('payroll:getPreviousBalance', employeeId, month),
    uploadDocument: (employeeId, month) => ipcRenderer.invoke('payroll:uploadDocument', employeeId, month),
    openDocument: (employeeId, month) => ipcRenderer.invoke('payroll:openDocument', employeeId, month),
    deleteDocument: (employeeId, month) => ipcRenderer.invoke('payroll:deleteDocument', employeeId, month),
    archiveRecord: (id) => ipcRenderer.invoke('payroll:archiveRecord', id),
    restoreRecord: (id) => ipcRenderer.invoke('payroll:restoreRecord', id),
    deleteRecord: (id) => ipcRenderer.invoke('payroll:deleteRecord', id),
  },

  reports: {
    savePdf: (payload) => ipcRenderer.invoke('reports:savePdf', payload),
    printHtml: (payload) => ipcRenderer.invoke('reports:printHtml', payload),
  },
});
