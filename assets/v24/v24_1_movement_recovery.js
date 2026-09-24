const MOVEMENT_STORAGE_PREFIX = 'family-cash-flow:pending-movements:v1:';
let movementRecoveryNotice = '';
let movementRecoveryBusy = false;

function resetMovementRecoveryNotice() {
  movementRecoveryNotice = '';
  const banner = document.getElementById('movementRecoveryBanner');
  if (banner) banner.classList.remove('show');
}

function movementStorageKey() {
  if (!AUTHENTICATED_USER) throw new Error('Sign in before recording a movement.');
  return MOVEMENT_STORAGE_PREFIX + encodeURIComponent(AUTHENTICATED_USER.toLowerCase());
}

function movementRecords() {
  try {
    const value = sessionStorage.getItem(movementStorageKey());
    const records = value ? JSON.parse(value) : [];
    if (!Array.isArray(records) || records.some(row => !row || typeof row.requestId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(row.requestId) || !row.movement || !['ktbTransfer', 'efWithdrawal', 'dedicatedTransfer'].includes(row.movement.action))) throw new Error('Invalid pending movement data.');
    return records;
  } catch (error) {
    throw new Error('Saved movement recovery is unavailable. Resolve it before recording another movement.');
  }
}

function saveMovementRecords(records) {
  try {
    sessionStorage.setItem(movementStorageKey(), JSON.stringify(records));
  } catch (error) {
    throw new Error('Saved movement recovery is unavailable. No movement was sent.');
  }
}

function secureMovementRequestId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  if (globalThis.crypto && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure request IDs are unavailable. No movement was sent.');
}

function pendingMovementFor(movement) {
  const semantic = JSON.stringify(movement);
  return movementRecords().find(row => JSON.stringify(row.movement) === semantic) || null;
}

function movementAttempt(movement) {
  const records = movementRecords();
  const semantic = JSON.stringify(movement);
  const existing = records.find(row => JSON.stringify(row.movement) === semantic);
  if (existing) {
    movementRecoveryNotice = '';
    existing.uncertain = true;
    saveMovementRecords(records);
    renderMovementRecoveryBanner();
    return existing;
  }
  if (records.length) throw new Error('Resolve the pending movement before recording a different movement. No movement was sent.');
  const attempt = { requestId: secureMovementRequestId(), movement, uncertain: false };
  records.push(attempt);
  saveMovementRecords(records);
  return attempt;
}

function markMovementUncertain(requestId) {
  movementRecoveryNotice = '';
  const records = movementRecords();
  const attempt = records.find(row => row.requestId === requestId);
  if (attempt) {
    attempt.uncertain = true;
    saveMovementRecords(records);
  }
  renderMovementRecoveryBanner();
}

function finishMovementAttempt(requestId) {
  saveMovementRecords(movementRecords().filter(row => row.requestId !== requestId));
  renderMovementRecoveryBanner();
}

function movementErrorMessage(error) {
  if (error?.kind === 'auth' || error?.status === 401) return 'Your session expired. Sign in again, then retry the same movement.';
  if (error?.kind === 'timeout') return 'The request timed out. Its result is unconfirmed. Retry the same movement.';
  if (error?.kind === 'transport') return 'The connection failed. Its result is unconfirmed. Retry the same movement.';
  if (error?.kind === 'invalid_response') return 'The service response could not be read. The result is unconfirmed. Retry the same movement.';
  if (error?.status >= 500) return 'The financial service is unavailable. The result is unconfirmed. Retry the same movement.';
  return error?.message || 'The movement result is unconfirmed. Retry the same movement.';
}

async function submitRecordedMovement(movement, messageId) {
  let attempt;
  try {
    attempt = movementAttempt(movement);
  } catch (error) {
    setMsg(messageId, movementErrorMessage(error));
    return false;
  }
  let result;
  try { result = await postAction({ ...movement, requestId: attempt.requestId }); }
  catch (error) {
    try {
      const uncertain = movementRecords().find(row => row.requestId === attempt.requestId)?.uncertain;
      if (error?.status === 400 && !uncertain) finishMovementAttempt(attempt.requestId);
      else markMovementUncertain(attempt.requestId);
    } catch {}
    setMsg(messageId, movementErrorMessage(error));
    renderMovementRecoveryBanner();
    return false;
  }
  if (!result.ok) {
    let uncertain;
    try { uncertain = movementRecords().find(row => row.requestId === attempt.requestId)?.uncertain; }
    catch (error) { setMsg(messageId, error.message); return false; }
    if (uncertain) {
      setMsg(messageId, result.error || 'The earlier result remains unconfirmed. Check history or retry the same movement.');
      renderMovementRecoveryBanner();
      return false;
    }
    try { finishMovementAttempt(attempt.requestId); } catch (error) { setMsg(messageId, error.message); return false; }
    setMsg(messageId, result.error || 'Could not record this movement.');
    return false;
  }
  movementRecoveryNotice = '';
  try { finishMovementAttempt(attempt.requestId); }
  catch { movementRecoveryNotice = 'Movement recorded. Saved recovery could not be cleared; check the dashboard before another movement.'; }
  renderMovementRecoveryBanner();
  return true;
}

function movementBanner() {
  let banner = document.getElementById('movementRecoveryBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'movementRecoveryBanner';
    banner.className = 'stale-banner';
    banner.setAttribute('role', 'status');
    document.getElementById('staleBanner').after(banner);
  }
  return banner;
}

function movementDescription(movement) {
  if (movement.action === 'ktbTransfer') return 'KTB transfer';
  if (movement.action === 'efWithdrawal') return 'Emergency Fund withdrawal';
  return movement.destinationType === 'Goal' ? 'Goal contribution' : 'Emergency Fund contribution';
}

function renderMovementRecoveryBanner() {
  if (!AUTHENTICATED_USER) return;
  let records;
  try { records = movementRecords(); } catch (error) {
    movementRecoveryNotice = error.message;
    records = [];
  }
  const banner = movementBanner();
  banner.replaceChildren();
  const unresolved = records.filter(row => row.uncertain);
  if (!unresolved.length && !movementRecoveryNotice) { banner.classList.remove('show'); return; }
  banner.style.flexWrap = 'wrap';
  const message = document.createElement('span');
  if (movementRecoveryNotice) message.textContent = movementRecoveryNotice;
  else {
    message.appendChild(document.createTextNode(movementDescription(unresolved[0].movement)));
    message.appendChild(document.createTextNode(': '));
    message.appendChild(document.createTextNode('An earlier result is unconfirmed. Check and retry it before recording another movement.'));
  }
  banner.appendChild(message);
  if (unresolved.length && !movementRecoveryBusy) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn secondary';
    button.textContent = 'Check and retry';
    button.addEventListener('click', () => retryPendingMovement(unresolved[0].requestId));
    banner.appendChild(button);
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'btn secondary';
    discard.textContent = 'Discard after checking history';
    discard.addEventListener('click', () => discardPendingMovement(unresolved[0].requestId));
    banner.appendChild(discard);
  }
  banner.classList.add('show');
}

function discardPendingMovement(requestId) {
  const question = document.documentElement.lang === 'ru'
    ? 'Сначала проверьте историю операций. Если прежняя операция уже записана, не записывайте её снова. Отмена ожидания позволит создать новый запрос и может привести к дублированию. Продолжить?'
    : 'Check transaction history first. If the earlier movement is already recorded, do not record it again. Discarding this pending request allows a new one and could duplicate a write still in progress. Continue?';
  if (!window.confirm(question)) return;
  try {
    finishMovementAttempt(requestId);
    movementRecoveryNotice = 'Pending movement discarded after history review. You can record a new movement.';
  } catch (error) { movementRecoveryNotice = error.message; }
  renderMovementRecoveryBanner();
}

async function checkMovementReceipt(attempt) {
  const status = await apiCall('movementRequestStatus', { requestId: attempt.requestId, movement: attempt.movement });
  if (!status.ok) throw new Error(status.error || 'Could not check the movement result.');
  return status;
}

async function reconcilePendingMovements() {
  if (!AUTHENTICATED_USER) return;
  let records;
  try { records = movementRecords(); } catch (error) { movementRecoveryNotice = error.message; renderMovementRecoveryBanner(); return; }
  if (records.length) {
    movementRecoveryNotice = '';
    records.forEach(row => { row.uncertain = true; });
    try { saveMovementRecords(records); }
    catch (error) { movementRecoveryNotice = error.message; renderMovementRecoveryBanner(); return; }
  }
  let confirmed = 0;
  for (const attempt of records) {
    try {
      const status = await checkMovementReceipt(attempt);
      if (status.found) { finishMovementAttempt(attempt.requestId); confirmed += 1; }
    } catch (error) {
      movementRecoveryNotice = movementErrorMessage(error);
      break;
    }
  }
  if (confirmed) {
    await refreshAfterRecordedMovement();
    if (!currentRenderMeta.stale) movementRecoveryNotice = 'An earlier movement was confirmed recorded. Dashboard data is current.';
  }
  renderMovementRecoveryBanner();
}

async function retryPendingMovement(requestId) {
  if (movementRecoveryBusy) return;
  let attempt;
  try { attempt = movementRecords().find(row => row.requestId === requestId); } catch (error) { movementRecoveryNotice = error.message; renderMovementRecoveryBanner(); return; }
  if (!attempt) { renderMovementRecoveryBanner(); return; }
  movementRecoveryBusy = true;
  movementRecoveryNotice = 'Checking the earlier movement…';
  renderMovementRecoveryBanner();
  let recorded = false;
  try {
    const status = await checkMovementReceipt(attempt);
    if (!status.found) {
      const result = await postAction({ ...attempt.movement, requestId: attempt.requestId });
      if (!result.ok) {
        movementRecoveryNotice = result.error || 'The earlier result remains unconfirmed. Check history or retry the same movement.';
        return;
      }
    }
    recorded = true;
    finishMovementAttempt(attempt.requestId);
    movementRecoveryNotice = 'Movement recorded. Refreshing dashboard data…';
    await refreshAfterRecordedMovement();
    if (!currentRenderMeta.stale) movementRecoveryNotice = 'Movement recorded. Dashboard data is current.';
  } catch (error) {
    if (!recorded) try { markMovementUncertain(attempt.requestId); } catch {}
    movementRecoveryNotice = recorded ? 'Movement recorded. Saved recovery could not be cleared; check the dashboard before another movement.' : movementErrorMessage(error);
  } finally {
    movementRecoveryBusy = false;
    renderMovementRecoveryBanner();
  }
}

async function refreshAfterRecordedMovement() {
  try {
    await refreshLiveData();
  } catch (error) {
    if (currentData) render(currentData, { stale: true });
    movementRecoveryNotice = 'Movement recorded, but dashboard data could not refresh. Refresh the page to update the balances.';
    renderMovementRecoveryBanner();
  }
}
