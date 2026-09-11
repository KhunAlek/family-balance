export function buildCorrectionCatalog(snapshot) {
  return {
    ok: true,
    entityTypes: [
      { value: 'salaryCycle', label: 'Salary cycle' }
    ],
    records: {
      salaryCycle: [{
        entityId: 'family',
        label: `${snapshot.salaryCycle?.current_cycle_start || 'Not set'} → ${snapshot.salaryCycle?.next_salary_date || 'Next salary not set'}`,
        source: 'Salary cycle'
      }]
    }
  };
}
