// Rotation-as-image export -----------------------------------------------
// Draws the rotation timeline + minutes grid onto a plain <canvas> using the
// in-memory rotation data (no DOM screenshot library needed), then either
// copies the resulting PNG to the clipboard or falls back to a download.

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderTimelineCanvas(rotation, players) {
  const theme = {
    bg: '#0b1020', card: '#121a2b', line: '#26324b',
    text: '#f6f7fb', muted: '#91a0b8', rowAlt: '#0f1727', accent: '#6d7cff', accent2: '#8290ff',
  };
  const fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const titleFont = `700 22px ${fontFamily}`;
  const subFont = `400 13px ${fontFamily}`;
  const labelFont = `650 14px ${fontFamily}`;
  const minutesFont = `500 12px ${fontFamily}`;
  const headerFont = `600 11px ${fontFamily}`;
  const subLabelFont = `600 9px ${fontFamily}`;
  const subLookup = buildSubLookup(rotation);

  const scale = 2;
  const padding = 28;
  const labelColWidth = 160;
  const blocks = rotation.result.length;
  const cellWidth = Math.max(34, Math.min(60, 720 / blocks));
  const width = padding * 2 + labelColWidth + cellWidth * blocks;

  const titleTop = padding;
  const headerTop = titleTop + 54;
  const headerHeight = 34;
  const rowHeight = 26;
  const rowGap = 8;
  const gridTop = headerTop + headerHeight + 8;

  const sorted = [...players].sort((a, b) => rotation.minutes[b.id] - rotation.minutes[a.id] || b.skill - a.skill);
  const totalHeight = gridTop + sorted.length * (rowHeight + rowGap) + padding;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(totalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, totalHeight);
  roundRect(ctx, 6, 6, width - 12, totalHeight - 12, 16);
  ctx.fillStyle = theme.card;
  ctx.fill();

  ctx.fillStyle = theme.text;
  ctx.font = titleFont;
  ctx.fillText('Rotation timeline', padding, titleTop);
  ctx.font = subFont;
  ctx.fillStyle = theme.muted;
  ctx.fillText(summary.textContent || '', padding, titleTop + 30);

  // Column headers
  for (let i = 0; i < blocks; i++) {
    const { half, label } = shortBlockHeader(i, rotation.blockMinutes);
    const prevHalf = i > 0 ? halfForBlock(i - 1, rotation.blockMinutes) : half;
    const x = padding + labelColWidth + i * cellWidth;
    if (i > 0 && half !== prevHalf) {
      ctx.strokeStyle = theme.accent2;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, headerTop); ctx.lineTo(x, totalHeight - padding); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.font = headerFont;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.fillText(`H${half}`, x + cellWidth / 2, headerTop);
    ctx.fillText(label, x + cellWidth / 2, headerTop + 14);
    ctx.textAlign = 'left';
  }

  sorted.forEach((p, rowIdx) => {
    const rowY = gridTop + rowIdx * (rowHeight + rowGap);
    ctx.font = labelFont;
    ctx.fillStyle = theme.text;
    ctx.fillText(p.name, padding, rowY + 6);
    if (p.number) {
      const nameWidth = ctx.measureText(p.name).width;
      ctx.font = `800 10px ${fontFamily}`;
      ctx.fillStyle = theme.muted;
      ctx.fillText(p.number, padding + nameWidth + 2, rowY + 2);
    }
    ctx.font = minutesFont;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${rotation.minutes[p.id]}m`, padding + labelColWidth - 12, rowY + 7);
    ctx.textAlign = 'left';

    // Row background track
    roundRect(ctx, padding + labelColWidth, rowY, cellWidth * blocks - 2, rowHeight, 6);
    ctx.fillStyle = theme.rowAlt;
    ctx.fill();

    // Draw contiguous "on court" runs as single rounded bars
    let runStart = null;
    for (let i = 0; i <= blocks; i++) {
      const on = i < blocks && rotation.result[i].lineup.some(x => x.id === p.id);
      if (on && runStart === null) runStart = i;
      if (!on && runStart !== null) {
        const x = padding + labelColWidth + runStart * cellWidth + 1;
        const w = (i - runStart) * cellWidth - 2;
        roundRect(ctx, x, rowY, w, rowHeight, 6);
        ctx.fillStyle = theme.accent;
        ctx.fill();

        if (runStart > 0) {
          const subOutPlayer = subLookup.get(`${runStart}:${p.id}`);
          if (subOutPlayer) {
            const text = `🔄 ${playerLabelSupText(subOutPlayer)}`;
            const maxWidth = Math.max(0, w - 8);
            ctx.save();
            roundRect(ctx, x, rowY, w, rowHeight, 6);
            ctx.clip();
            ctx.font = subLabelFont;
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + 5, rowY + rowHeight / 2 + 1, maxWidth);
            ctx.textBaseline = 'top';
            ctx.restore();
          }
        }
        runStart = null;
      }
    }
  });

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector('#copyRotationImage').addEventListener('click', async () => {
  if (!lastRotation) return;
  const btn = document.querySelector('#copyRotationImage');
  const old = btn.textContent;
  const players = state.players.filter(p => p.present);
  const renderCanvas = () => renderTimelineCanvas(lastRotation, players);
  try {
    const canvas = renderCanvas();
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error('Could not create image.');
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.textContent = '✅ Copied!';
    } else {
      downloadBlob(blob, 'rotation.png');
      btn.textContent = '✅ Downloaded';
    }
  } catch (e) {
    try {
      const canvas = renderCanvas();
      const blob = await canvasToBlob(canvas);
      if (blob) { downloadBlob(blob, 'rotation.png'); btn.textContent = '✅ Downloaded'; }
      else throw e;
    } catch (e2) {
      alert('Could not copy or download the image.');
      return;
    }
  } finally {
    setTimeout(() => { btn.textContent = old; }, 1400);
  }
});

document.querySelector('#printRotation').addEventListener('click', () => {
  if (!lastRotation) return;
  window.print();
});
