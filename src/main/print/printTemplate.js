const fs = require('node:fs');
const path = require('node:path');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTeamReportTemplatePath() {
  return path.resolve(__dirname, '../../renderer/printTemplates/TeamReportTemplate.html');
}

function replaceTokens(template, replacements) {
  return Object.entries(replacements).reduce(
    (output, [token, value]) => output.replaceAll(`{{${token}}}`, value),
    template
  );
}

function buildComponentsRows(data) {
  const rows = Array.isArray(data?.items?.payrollComponents) ? data.items.payrollComponents : [];
  if (!rows.length) {
    return '<tr><td colspan="3" class="muted-cell">Nessuna busta componente registrata.</td></tr>';
  }

  return rows
    .map((item) => `
      <tr>
        <td>${escapeHtml(item.label)}</td>
        <td class="num">${escapeHtml(item.daysLabel)}</td>
        <td class="num">${escapeHtml(item.amountLabel)}</td>
      </tr>
    `)
    .join('');
}

function buildOptionalBlock({ enabled, title, description, amountLabel, accentClass }) {
  if (!enabled) {
    return '';
  }

  return `
    <section class="section-card">
      <div class="section-label">${escapeHtml(title)}</div>
      <div class="econ-row">
        <div>
          <div class="econ-label">${escapeHtml(description)}</div>
          <div class="econ-sub">Voce positiva inclusa nel saldo finale squadra</div>
        </div>
        <div class="econ-amount ${escapeHtml(accentClass)}">+ ${escapeHtml(amountLabel)}</div>
      </div>
    </section>
  `;
}

function renderTeamReportHtml(data) {
  const templatePath = getTeamReportTemplatePath();
  const template = fs.readFileSync(templatePath, 'utf8');

  return replaceTokens(template, {
    BRAND: escapeHtml(data?.meta?.brand || 'GPA 1.0.5'),
    GENERATED_AT: escapeHtml(data?.meta?.generatedAt || ''),
    TEAM_NAME: escapeHtml(data?.team?.name || ''),
    MONTH_LABEL: escapeHtml(data?.team?.monthLabel || ''),
    TOTAL_HOURS: escapeHtml(data?.team?.totalHoursLabel || ''),
    PRESENCES: escapeHtml(data?.team?.headcountPresencesLabel || ''),
    EQUIVALENT_DAYS: escapeHtml(data?.team?.equivalentDaysLabel || ''),
    STANDARD_DAY_HOURS: escapeHtml(String(data?.team?.standardDayHours || 7)),
    GROSS_COMPENSATION: escapeHtml(data?.economics?.grossCompensationLabel || ''),
    FORMULA_LABEL: escapeHtml(data?.economics?.formulaLabel || ''),
    TRANSPORT_BLOCK: buildOptionalBlock({
      enabled: !!data?.economics?.transportEnabled && Number(data?.economics?.transportAmount || 0) > 0,
      title: 'Trasporto squadra',
      description: data?.economics?.transportDescription || 'Trasporto squadra',
      amountLabel: data?.economics?.transportAmountLabel || '€ 0,00',
      accentClass: 'accent-transport',
    }),
    GIFT_BLOCK: buildOptionalBlock({
      enabled: !!data?.economics?.giftEnabled && Number(data?.economics?.giftAmount || 0) > 0,
      title: 'Regalo squadra',
      description: data?.economics?.giftDescription || 'Regalo squadra',
      amountLabel: data?.economics?.giftAmountLabel || '€ 0,00',
      accentClass: 'accent-gift',
    }),
    ADVANCES_TOTAL: escapeHtml(data?.economics?.advancesTotalLabel || ''),
    PAYROLL_COMPONENTS_TOTAL: escapeHtml(data?.economics?.payrollComponentsTotalLabel || ''),
    FINAL_BALANCE: escapeHtml(data?.economics?.finalBalanceLabel || ''),
    COMPONENT_ROWS: buildComponentsRows(data),
    NOTE: escapeHtml(data?.note || 'Nessuna nota aggiuntiva.'),
  });
}

module.exports = {
  getTeamReportTemplatePath,
  renderTeamReportHtml,
};
