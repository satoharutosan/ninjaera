function escapeCsv(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildDevStatusCsv(data) {
  const lines = [];

  lines.push('Section,Field,Value');
  lines.push(['Project', 'Name', 'Ninja Era'].map(escapeCsv).join(','));
  lines.push(['Export', 'Generated At', data.exportedAt].map(escapeCsv).join(','));
  lines.push(['Team', 'Member', data.teamMember].map(escapeCsv).join(','));
  lines.push(['Sprint', 'Name', data.sprint?.name ?? ''].map(escapeCsv).join(','));
  lines.push(['Sprint', 'Day', data.sprint?.day ?? ''].map(escapeCsv).join(','));
  lines.push(['Sprint', 'Progress %', data.sprint?.progress ?? ''].map(escapeCsv).join(','));

  lines.push('');
  lines.push('Tasks,ID,Title,Status,Assignee,Priority,Milestone,Updated');

  for (const task of data.tasks || []) {
    lines.push(
      [
        'Task',
        task.id,
        task.title,
        task.status,
        task.assignee,
        task.priority,
        task.milestone ?? '',
        task.updatedAt,
      ]
        .map(escapeCsv)
        .join(',')
    );
  }

  lines.push('');
  lines.push('Goals,ID,Title,Progress %,Due Date');

  for (const goal of data.goals || []) {
    lines.push(
      ['Goal', goal.id, goal.title, goal.progress, goal.dueDate]
        .map(escapeCsv)
        .join(',')
    );
  }

  lines.push('');
  lines.push('Instructions,ID,Title,From,Priority,Received,Read');

  for (const inst of data.instructions || []) {
    lines.push(
      [
        'Instruction',
        inst.id,
        inst.title,
        inst.from,
        inst.priority,
        inst.receivedAt,
        inst.read ? 'yes' : 'no',
      ]
        .map(escapeCsv)
        .join(',')
    );
  }

  lines.push('');
  lines.push('Release,Current,Latest,Last Checked,Pending Install');

  lines.push(
    [
      'Release',
      data.release?.currentVersion ?? '',
      data.release?.latestVersion ?? '',
      data.release?.lastChecked ?? '',
      data.release?.pendingInstall ? 'yes' : 'no',
    ]
      .map(escapeCsv)
      .join(',')
  );

  return lines.join('\r\n');
}

export function downloadCsv(filename, content) {
  const blob = new Blob(['\ufeff' + content], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  return chrome.downloads.download({
    url,
    filename,
    saveAs: true,
  });
}
