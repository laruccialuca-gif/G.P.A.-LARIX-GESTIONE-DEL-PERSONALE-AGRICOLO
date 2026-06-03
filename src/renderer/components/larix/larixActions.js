import { formatLarixMonthKey, parseLarixCommand } from './larixCommandParser';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function employeeDisplayName(employee) {
  return [
    String(employee?.first_name || '').trim(),
    String(employee?.last_name || '').trim(),
  ].filter(Boolean).join(' ').trim() || 'Dipendente';
}

function teamDisplayName(team) {
  return String(team?.name || '').trim() || 'Squadra';
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

function buildNavigateAction(path, params = {}, meta = {}) {
  return {
    type: 'navigate',
    to: `${path}${buildQuery(params)}`,
    year: meta.year || null,
    description: meta.description || '',
  };
}

function scoreEmployeeMatch(employee, term) {
  const normalizedTerm = normalizeText(term);
  const fullName = normalizeText(employeeDisplayName(employee));
  const reversedName = normalizeText(`${employee?.last_name || ''} ${employee?.first_name || ''}`);
  if (!normalizedTerm) return 0;
  if (fullName === normalizedTerm || reversedName === normalizedTerm) return 100;
  if (fullName.startsWith(normalizedTerm) || reversedName.startsWith(normalizedTerm)) return 80;
  const tokens = normalizedTerm.split(' ').filter(Boolean);
  if (tokens.length && tokens.every((token) => fullName.includes(token) || reversedName.includes(token))) {
    return 60 + tokens.length;
  }
  if (fullName.includes(normalizedTerm) || reversedName.includes(normalizedTerm)) return 40;
  return 0;
}

function findEmployeeMatches(employees = [], term) {
  return [...employees]
    .map((employee) => ({ employee, score: scoreEmployeeMatch(employee, term) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || employeeDisplayName(left.employee).localeCompare(employeeDisplayName(right.employee), 'it', { sensitivity: 'base' }))
    .map((entry) => entry.employee);
}

function findTeamMatches(teams = [], term) {
  const normalizedTerm = normalizeText(term);
  return [...teams]
    .map((team) => {
      const name = normalizeText(teamDisplayName(team));
      let score = 0;
      if (name === normalizedTerm) score = 100;
      else if (name.startsWith(normalizedTerm)) score = 80;
      else if (name.includes(normalizedTerm)) score = 50;
      return { team, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || teamDisplayName(left.team).localeCompare(teamDisplayName(right.team), 'it', { sensitivity: 'base' }))
    .map((entry) => entry.team);
}

function defaultMonthKey(selectedYear) {
  const today = new Date();
  return `${Number(selectedYear) || today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
}

function buildChoiceResult(message, choices) {
  return {
    type: 'choice',
    message,
    choices,
  };
}

export async function resolveLarixCommand(command, context = {}) {
  const parsed = parseLarixCommand(command, { selectedYear: context.selectedYear });
  const monthKey = formatLarixMonthKey(parsed.monthKey) || defaultMonthKey(context.selectedYear);
  const monthYear = Number(String(monthKey).slice(0, 4));

  if (!parsed.target) {
    return {
      type: 'reply',
      message: 'Non ho capito il comando. Posso aiutarti con report, presenze, storico, preview pagamenti, comunicazione o operai assunti.',
    };
  }

  if (parsed.target === 'presenze') {
    return {
      type: 'navigate',
      message: 'Ti porto nel foglio Presenze.',
      action: buildNavigateAction('/presenze', {}, { year: context.selectedYear, description: 'Vai a Presenze' }),
    };
  }

  if (parsed.target === 'operai-assunti') {
    return {
      type: 'navigate',
      message: 'Apro la pagina Operai Assunti.',
      action: buildNavigateAction('/operai-assunti', {}, { year: context.selectedYear, description: 'Apri Operai Assunti' }),
    };
  }

  if (parsed.target === 'stampa-documenti') {
    return {
      type: 'navigate',
      message: 'Apro Stampa e Documenti.',
      action: buildNavigateAction('/stampa-documenti', {}, { year: context.selectedYear, description: 'Apri Stampa e Documenti' }),
    };
  }

  if (parsed.target === 'preview-pagamenti') {
    return {
      type: 'navigate',
      message: `Apro Preview pagamenti per ${monthKey}.`,
      action: buildNavigateAction('/preview-pagamenti', { month: monthKey }, { year: monthYear, description: 'Apri Preview Pagamenti' }),
    };
  }

  if (parsed.target === 'comunicazione') {
    return {
      type: 'navigate',
      message: `Apro Comunicazione per ${monthKey}.`,
      action: buildNavigateAction('/comunicazione', { month: monthKey }, { year: monthYear, description: 'Apri Comunicazione' }),
    };
  }

  if (parsed.target === 'dipendenti') {
    if (!parsed.employeeTerm) {
      return {
        type: 'navigate',
        message: 'Apro la pagina Dipendenti.',
        action: buildNavigateAction('/dipendenti', {}, { year: context.selectedYear, description: 'Apri Dipendenti' }),
      };
    }

    const employees = await context.loadEmployees();
    const matches = findEmployeeMatches(employees, parsed.employeeTerm);
    if (!matches.length) {
      return {
        type: 'reply',
        message: `Non ho trovato nessun dipendente compatibile con "${parsed.employeeTerm}".`,
      };
    }

    if (matches.length === 1) {
      const employee = matches[0];
      return {
        type: 'navigate',
        message: `Apro la scheda Dipendenti per ${employeeDisplayName(employee)}.`,
        action: buildNavigateAction('/dipendenti', { employee: employee.id }, { year: context.selectedYear, description: 'Apri Dipendente' }),
      };
    }

    return buildChoiceResult(
      `Ho trovato più dipendenti compatibili con "${parsed.employeeTerm}". Quale vuoi aprire?`,
      matches.slice(0, 5).map((employee) => ({
        id: `employee-${employee.id}`,
        label: employeeDisplayName(employee),
        action: buildNavigateAction('/dipendenti', { employee: employee.id }, { year: context.selectedYear, description: 'Apri Dipendente' }),
      }))
    );
  }

  if (parsed.target === 'report') {
    if (parsed.teamTerm) {
      const teams = await context.loadTeams();
      const matches = findTeamMatches(teams, parsed.teamTerm);
      if (!matches.length) {
        return {
          type: 'reply',
          message: `Non ho trovato nessuna squadra compatibile con "${parsed.teamTerm}".`,
        };
      }
      if (matches.length === 1) {
        const team = matches[0];
        return {
          type: 'navigate',
          message: `Apro il report squadra ${teamDisplayName(team)} per ${monthKey}.`,
          action: buildNavigateAction('/report', { team: team.id, month: monthKey }, { year: monthYear, description: 'Apri Report Squadra' }),
        };
      }
      return buildChoiceResult(
        `Ho trovato più squadre compatibili con "${parsed.teamTerm}". Quale vuoi aprire?`,
        matches.slice(0, 5).map((team) => ({
          id: `team-${team.id}`,
          label: teamDisplayName(team),
          action: buildNavigateAction('/report', { team: team.id, month: monthKey }, { year: monthYear, description: 'Apri Report Squadra' }),
        }))
      );
    }

    if (!parsed.employeeTerm) {
      return {
        type: 'reply',
        message: 'Per aprire un report indicami almeno un dipendente o una squadra. Esempio: "apri report Giuseppe Pugliese maggio".',
      };
    }

    const employees = await context.loadEmployees();
    const matches = findEmployeeMatches(employees, parsed.employeeTerm);
    if (!matches.length) {
      return {
        type: 'reply',
        message: `Non ho trovato nessun dipendente compatibile con "${parsed.employeeTerm}".`,
      };
    }
    if (matches.length === 1) {
      const employee = matches[0];
      return {
        type: 'navigate',
        message: `Apro il report di ${employeeDisplayName(employee)} per ${monthKey}.`,
        action: buildNavigateAction('/report', { employee: employee.id, month: monthKey }, { year: monthYear, description: 'Apri Report Dipendente' }),
      };
    }
    return buildChoiceResult(
      `Ho trovato più dipendenti compatibili con "${parsed.employeeTerm}". Quale report vuoi aprire?`,
      matches.slice(0, 5).map((employee) => ({
        id: `report-employee-${employee.id}`,
        label: employeeDisplayName(employee),
        action: buildNavigateAction('/report', { employee: employee.id, month: monthKey }, { year: monthYear, description: 'Apri Report Dipendente' }),
      }))
    );
  }

  if (parsed.target === 'storico-operaio') {
    if (!parsed.employeeTerm) {
      return {
        type: 'navigate',
        message: `Apro lo Storico report filtrato su ${monthKey}.`,
        action: buildNavigateAction('/storico-operaio', { month: monthKey }, { year: monthYear, description: 'Apri Storico' }),
      };
    }
    const employees = await context.loadEmployees();
    const matches = findEmployeeMatches(employees, parsed.employeeTerm);
    if (!matches.length) {
      return {
        type: 'reply',
        message: `Non ho trovato nessun dipendente compatibile con "${parsed.employeeTerm}".`,
      };
    }
    if (matches.length === 1) {
      const employee = matches[0];
      return {
        type: 'navigate',
        message: `Apro lo Storico di ${employeeDisplayName(employee)} per ${monthKey}.`,
        action: buildNavigateAction('/storico-operaio', { employee: employee.id, month: monthKey }, { year: monthYear, description: 'Apri Storico Dipendente' }),
      };
    }
    return buildChoiceResult(
      `Ho trovato più dipendenti compatibili con "${parsed.employeeTerm}". Quale storico vuoi aprire?`,
      matches.slice(0, 5).map((employee) => ({
        id: `history-employee-${employee.id}`,
        label: employeeDisplayName(employee),
        action: buildNavigateAction('/storico-operaio', { employee: employee.id, month: monthKey }, { year: monthYear, description: 'Apri Storico Dipendente' }),
      }))
    );
  }

  return {
    type: 'reply',
    message: 'Per ora posso aiutarti soprattutto con navigazione e ricerca nelle pagine principali del gestionale.',
  };
}

