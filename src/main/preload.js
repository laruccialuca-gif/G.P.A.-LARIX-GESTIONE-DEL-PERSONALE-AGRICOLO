const { contextBridge, ipcRenderer } = require('electron');

function subscribeToChannel(channel, handler) {
  if (typeof handler !== 'function') {
    return () => {};
  }

  const listener = (_, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('api', {
  auth: {
    hasUsers: () => ipcRenderer.invoke('auth:hasUsers'),
    getLoginHints: () => ipcRenderer.invoke('auth:getLoginHints'),
    login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
    loginSuperAdmin: (password) => ipcRenderer.invoke('auth:loginSuperAdmin', password),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
    createFirstAdmin: (payload) => ipcRenderer.invoke('auth:createFirstAdmin', payload),
  },

  users: {
    list: () => ipcRenderer.invoke('users:list'),
    create: (payload) => ipcRenderer.invoke('users:create', payload),
    update: (id, payload) => ipcRenderer.invoke('users:update', id, payload),
    disable: (id) => ipcRenderer.invoke('users:disable', id),
    enable: (id) => ipcRenderer.invoke('users:enable', id),
    resetPassword: (id, newPassword) => ipcRenderer.invoke('users:resetPassword', id, newPassword),
    changeOwnPassword: (newPassword) => ipcRenderer.invoke('users:changeOwnPassword', newPassword),
    changeManagedPassword: (id, newPassword) => ipcRenderer.invoke('users:changeManagedPassword', id, newPassword),
    getAuditLogs: (options) => ipcRenderer.invoke('users:getAuditLogs', options),
  },

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
    verify: () => ipcRenderer.invoke('license:verify'),
    deactivate: () => ipcRenderer.invoke('license:deactivate'),
    getActivationRequest: () => ipcRenderer.invoke('license:getActivationRequest'),
  },

  backups: {
    list: () => ipcRenderer.invoke('backups:list'),
    create: (type) => ipcRenderer.invoke('backups:create', type),
    openDirectory: () => ipcRenderer.invoke('backups:openDirectory'),
    chooseRestore: () => ipcRenderer.invoke('backups:chooseRestore'),
    restore: (backupDir) => ipcRenderer.invoke('backups:restore', backupDir),
  },

  diagnostics: {
    generateReport: () => ipcRenderer.invoke('diagnostics:generateReport'),
    logRendererError: (payload) => ipcRenderer.invoke('diagnostics:logRendererError', payload),
    logRendererEvent: (payload) => ipcRenderer.invoke('diagnostics:logRendererEvent', payload),
  },

  operations: {
    getActiveJobs: () => ipcRenderer.invoke('operations:getActiveJobs'),
    cancel: (type) => ipcRenderer.invoke('operations:cancel', type),
    reset: (type, reason) => ipcRenderer.invoke('operations:reset', type, reason),
    onProgress: (handler) => subscribeToChannel('operations:progress', handler),
  },

  employees: {
    list: (options) => ipcRenderer.invoke('employees:list', options),
    listBasic: (options) => ipcRenderer.invoke('employees:listBasic', options),
    listBasicForAttendance: (options) => ipcRenderer.invoke('employees:listBasicForAttendance', options),
    getById: (id, options) => ipcRenderer.invoke('employees:getById', id, options),
    getDocumentsSummary: (id) => ipcRenderer.invoke('employees:getDocumentsSummary', id),
    findHistoryMatches: (criteria) => ipcRenderer.invoke('employees:findHistoryMatches', criteria),
    create: (payload) => ipcRenderer.invoke('employees:create', payload),
    update: (id, payload) => ipcRenderer.invoke('employees:update', id, payload),
    archive: (id) => ipcRenderer.invoke('employees:archive', id),
    bulkArchive: (ids) => ipcRenderer.invoke('employees:bulkArchive', ids),
    closeEarly: (employeeIds, terminationDate, reason) =>
      ipcRenderer.invoke('employees:closeEarly', employeeIds, terminationDate, reason),
    archiveExpiredContracts: (today) => ipcRenderer.invoke('employees:archiveExpiredContracts', today),
    restore: (id) => ipcRenderer.invoke('employees:restore', id),
    deletePermanently: (id) => ipcRenderer.invoke('employees:deletePermanently', id),
    bulkDelete: (ids) => ipcRenderer.invoke('employees:bulkDelete', ids),
    parsePdfImport: (options) => ipcRenderer.invoke('employees:parsePdfImport', options),
    runOcrOnlineImport: (payload) => ipcRenderer.invoke('employees:runOcrOnlineImport', payload),
    evaluatePdfImportRows: (payload) => ipcRenderer.invoke('employees:evaluatePdfImportRows', payload),
    resolvePdfEmployer: (payload) => ipcRenderer.invoke('employees:resolvePdfEmployer', payload),
    confirmPdfImport: (payload) => ipcRenderer.invoke('employees:confirmPdfImport', payload),
    uploadHireDocument: (employeeId) => ipcRenderer.invoke('employees:uploadHireDocument', employeeId),
    uploadHireDocumentForPeriod: (employeeId, employmentPeriodId) =>
      ipcRenderer.invoke('employees:uploadHireDocumentForPeriod', employeeId, employmentPeriodId),
    openHireDocument: (employeeId) => ipcRenderer.invoke('employees:openHireDocument', employeeId),
    openHireDocumentForPeriod: (employeeId, employmentPeriodId) =>
      ipcRenderer.invoke('employees:openHireDocumentForPeriod', employeeId, employmentPeriodId),
    openDocumentById: (documentId) => ipcRenderer.invoke('employees:openDocumentById', documentId),
    deleteHireDocument: (employeeId) => ipcRenderer.invoke('employees:deleteHireDocument', employeeId),
    deleteHireDocumentForPeriod: (employeeId, employmentPeriodId) =>
      ipcRenderer.invoke('employees:deleteHireDocumentForPeriod', employeeId, employmentPeriodId),
    uploadArt37Document: (employeeId) => ipcRenderer.invoke('employees:uploadArt37Document', employeeId),
    openArt37Document: (employeeId) => ipcRenderer.invoke('employees:openArt37Document', employeeId),
    deleteArt37Document: (employeeId) => ipcRenderer.invoke('employees:deleteArt37Document', employeeId),
    uploadMedicalVisitDocument: (employeeId) => ipcRenderer.invoke('employees:uploadMedicalVisitDocument', employeeId),
    openMedicalVisitDocument: (employeeId) => ipcRenderer.invoke('employees:openMedicalVisitDocument', employeeId),
    deleteMedicalVisitDocument: (employeeId) => ipcRenderer.invoke('employees:deleteMedicalVisitDocument', employeeId),
    uploadDpiDeliveryDocument: (employeeId) => ipcRenderer.invoke('employees:uploadDpiDeliveryDocument', employeeId),
    openDpiDeliveryDocument: (employeeId) => ipcRenderer.invoke('employees:openDpiDeliveryDocument', employeeId),
    deleteDpiDeliveryDocument: (employeeId) => ipcRenderer.invoke('employees:deleteDpiDeliveryDocument', employeeId),
  },

  dpi: {
    listItems: (options) => ipcRenderer.invoke('dpi:listItems', options),
    createItem: (payload) => ipcRenderer.invoke('dpi:createItem', payload),
    updateItem: (id, payload) => ipcRenderer.invoke('dpi:updateItem', id, payload),
    archiveItem: (id) => ipcRenderer.invoke('dpi:archiveItem', id),
    deleteItem: (id) => ipcRenderer.invoke('dpi:deleteItem', id),
    listAssignments: (options) => ipcRenderer.invoke('dpi:listAssignments', options),
    createAssignment: (payload) => ipcRenderer.invoke('dpi:createAssignment', payload),
    updateAssignment: (id, payload) => ipcRenderer.invoke('dpi:updateAssignment', id, payload),
    deleteAssignment: (id) => ipcRenderer.invoke('dpi:deleteAssignment', id),
    getEmployeeAssignments: (employeeId) => ipcRenderer.invoke('dpi:getEmployeeAssignments', employeeId),
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

  teamPayroll: {
    listAdvances: (teamId, month, options) => ipcRenderer.invoke('teamPayroll:listAdvances', teamId, month, options),
    listAvailableAdvances: (teamId, month) => ipcRenderer.invoke('teamPayroll:listAvailableAdvances', teamId, month),
    listAllAdvances: (options) => ipcRenderer.invoke('teamPayroll:listAllAdvances', options),
    createAdvance: (payload) => ipcRenderer.invoke('teamPayroll:createAdvance', payload),
    updateAdvance: (id, payload) => ipcRenderer.invoke('teamPayroll:updateAdvance', id, payload),
    deleteAdvance: (id) => ipcRenderer.invoke('teamPayroll:deleteAdvance', id),
    setAdvancesImported: (ids, includeInReport) => ipcRenderer.invoke('teamPayroll:setAdvancesImported', ids, includeInReport),
    getReportRecord: (teamId, month) => ipcRenderer.invoke('teamPayroll:getReportRecord', teamId, month),
    listReportRecords: (options) => ipcRenderer.invoke('teamPayroll:listReportRecords', options),
    saveReportRecord: (payload) => ipcRenderer.invoke('teamPayroll:saveReportRecord', payload),
    listPayrollComponents: (teamId, month) => ipcRenderer.invoke('teamPayroll:listPayrollComponents', teamId, month),
    createPayrollComponent: (payload) => ipcRenderer.invoke('teamPayroll:createPayrollComponent', payload),
    updatePayrollComponent: (id, payload) => ipcRenderer.invoke('teamPayroll:updatePayrollComponent', id, payload),
    deletePayrollComponent: (id) => ipcRenderer.invoke('teamPayroll:deletePayrollComponent', id),
    replacePayrollComponents: (teamId, month, items) => ipcRenderer.invoke('teamPayroll:replacePayrollComponents', teamId, month, items),
  },

  reportAutoNotes: {
    getByMonth: (month) => ipcRenderer.invoke('reportAutoNotes:getByMonth', month),
  },

  communications: {
    list: (options) => ipcRenderer.invoke('communications:list', options),
    getById: (id) => ipcRenderer.invoke('communications:getById', id),
    getByMonth: (monthReference) => ipcRenderer.invoke('communications:getByMonth', monthReference),
    save: (payload) => ipcRenderer.invoke('communications:save', payload),
    delete: (id) => ipcRenderer.invoke('communications:delete', id),
    openFile: (id, type) => ipcRenderer.invoke('communications:openFile', id, type),
    generateSelectedPdf: (id, selectedEmployeeIds) => ipcRenderer.invoke('communications:generateSelectedPdf', id, selectedEmployeeIds),
    sendEmail: (id, options) => ipcRenderer.invoke('communications:sendEmail', id, options),
    listContacts: () => ipcRenderer.invoke('communications:listContacts'),
    saveContact: (payload) => ipcRenderer.invoke('communications:saveContact', payload),
    deleteContact: (id) => ipcRenderer.invoke('communications:deleteContact', id),
  },

  attendance: {
    save: (payload) => ipcRenderer.invoke('attendance:save', payload),
    bulkUpsert: (payload) => ipcRenderer.invoke('attendance:bulkUpsert', payload),
    teamBulkUpsert: (payload) => ipcRenderer.invoke('attendance:teamBulkUpsert', payload),
    listByMonth: (year, month) => ipcRenderer.invoke('attendance:listByMonth', year, month),
    listTeamByMonth: (year, month) => ipcRenderer.invoke('attendance:listTeamByMonth', year, month),
    monthlySummary: (month) => ipcRenderer.invoke('attendance:monthlySummary', month),
    getMatrix: (month) => ipcRenderer.invoke('attendance:getMatrix', month),
  },

  payroll: {
    saveRecord: (payload) => ipcRenderer.invoke('payroll:saveRecord', payload),
    listByEmployee: (employeeId) => ipcRenderer.invoke('payroll:listByEmployee', employeeId),
    listByEmployees: (options) => ipcRenderer.invoke('payroll:listByEmployees', options),
    listHistory: (options) => ipcRenderer.invoke('payroll:listHistory', options),
    getRecord: (employeeId, month) => ipcRenderer.invoke('payroll:getRecord', employeeId, month),
    getRecordById: (id) => ipcRenderer.invoke('payroll:getRecordById', id),
    updatePaymentStatus: (id, paymentStatus, paymentDate, partialPaidAmount, remainingBalance) =>
      ipcRenderer.invoke('payroll:updatePaymentStatus', id, paymentStatus, paymentDate, partialPaidAmount, remainingBalance),
    getPreviousBalance: (employeeId, month) =>
      ipcRenderer.invoke('payroll:getPreviousBalance', employeeId, month),
    uploadDocument: (employeeId, month) => ipcRenderer.invoke('payroll:uploadDocument', employeeId, month),
    openDocument: (employeeId, month) => ipcRenderer.invoke('payroll:openDocument', employeeId, month),
    deleteDocument: (employeeId, month) => ipcRenderer.invoke('payroll:deleteDocument', employeeId, month),
    archiveRecord: (id) => ipcRenderer.invoke('payroll:archiveRecord', id),
    restoreRecord: (id) => ipcRenderer.invoke('payroll:restoreRecord', id),
    deleteRecord: (id) => ipcRenderer.invoke('payroll:deleteRecord', id),
  },

  financialMovements: {
    list: (options) => ipcRenderer.invoke('financialMovements:list', options),
    listAvailable: (options) => ipcRenderer.invoke('financialMovements:listAvailable', options),
    countAvailable: (employeeId) => ipcRenderer.invoke('financialMovements:countAvailable', employeeId),
    countPendingForMonth: (employeeId, month) =>
      ipcRenderer.invoke('financialMovements:countPendingForMonth', employeeId, month),
    save: (payload) => ipcRenderer.invoke('financialMovements:save', payload),
    createManyForEmployees: (payload) =>
      ipcRenderer.invoke('financialMovements:createManyForEmployees', payload),
    delete: (id) => ipcRenderer.invoke('financialMovements:delete', id),
    markInserted: (ids, context) => ipcRenderer.invoke('financialMovements:markInserted', ids, context),
  },

  reports: {
    savePdf: (payload) => ipcRenderer.invoke('reports:savePdf', payload),
    savePdfToFolder: (payload) => ipcRenderer.invoke('reports:savePdfToFolder', payload),
    printHtml: (payload) => ipcRenderer.invoke('reports:printHtml', payload),
  },

  teamReport: {
    previewTemplate: (payload) => ipcRenderer.invoke('teamReport:previewTemplate', payload),
    generatePdfTemplate: (payload) => ipcRenderer.invoke('teamReport:generatePdfTemplate', payload),
    printTemplate: (payload) => ipcRenderer.invoke('teamReport:printTemplate', payload),
  },

  employeeReport: {
    previewTemplate: (payload) => ipcRenderer.invoke('employeeReport:previewTemplate', payload),
    generatePdfTemplate: (payload) => ipcRenderer.invoke('employeeReport:generatePdfTemplate', payload),
    printTemplate: (payload) => ipcRenderer.invoke('employeeReport:printTemplate', payload),
  },

  printDocuments: {
    listDocuments: (filters) => ipcRenderer.invoke('printDocuments:listDocuments', filters),
    openDocument: (relativePath) => ipcRenderer.invoke('printDocuments:openDocument', relativePath),
    printDocument: (relativePath) => ipcRenderer.invoke('printDocuments:printDocument', relativePath),
    exportDocument: (relativePath, suggestedFileName) =>
      ipcRenderer.invoke('printDocuments:exportDocument', relativePath, suggestedFileName),
  },
});
