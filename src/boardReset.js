function resetBoardAppearance(kind) {
  if (!['colors', 'cells', 'text', 'all'].includes(kind) || pendingPanelMoves.length) return;
  if (kind === 'colors' || kind === 'all') {
    const state = savedPanelHueState();
    const slots = Object.keys(state).filter(key => /^\d{1,3}$/.test(key)).map(Number);
    savePanelHues(slots, [null]);
  }
  if (kind === 'text' || kind === 'all') {
    const sizes = panelFontSizes();
    for (const slot of Object.keys(sizes)) if (/^\d{1,3}$/.test(slot)) sizes[slot] = null;
    preferenceStorage.setItem(panelFontStorageKey(), JSON.stringify(sizes));
    applyPanelFonts();
    scheduleTileGeometryRefresh();
  }
  if (kind === 'cells' || kind === 'all') {
    // Keep navigation mode and the current panel neighborhood on this device.
    const saved = storedBoardValue(mobileStorageKey(), {});
    const first = (saved.page || 0) * (saved.density || 2);
    preferenceStorage.setItem(mobileStorageKey(), JSON.stringify({ ...saved, height: 240, density: 2, page: Math.floor(first / 2) }));
    mobileStateBoard = '';
    if (mobileReady) renderMobile(mobileLastData);
    post('resetCellSizes', { boardId: currentBoardId(), resetKind: kind });
  } else note(kind === 'colors' ? 'Board colors restored to theme' : 'Board text sizes restored');
}
document.querySelectorAll('[data-board-reset]').forEach(button => {
  button.addEventListener('click', () => resetBoardAppearance(button.dataset.boardReset));
});
