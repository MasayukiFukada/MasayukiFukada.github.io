/**
 * DocAnnotator - Wiki/Markdown Screen Annotation PWA
 */

(function () {
  'use strict';

  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const canvasWrapper = document.getElementById('canvas-wrapper');
  const canvas = document.getElementById('annotation-canvas');
  const ctx = canvas.getContext('2d');
  const textEditorContainer = document.getElementById('text-editor-container');
  const textEditor = document.getElementById('text-editor-overlay');
  const btnTextOk = document.getElementById('btn-text-ok');
  const btnTextCancel = document.getElementById('btn-text-cancel');
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  const statusInfo = document.getElementById('status-info');
  const badgeCounterInput = document.getElementById('badge-counter');
  const badgeOptions = document.getElementById('badge-options');
  const loupeOptions = document.getElementById('loupe-options');
  const loupeZoomSelect = document.getElementById('loupe-zoom');
  const mosaicOptions = document.getElementById('mosaic-options');
  const maskTypeSelect = document.getElementById('mask-type');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnDelete = document.getElementById('btn-delete');
  const btnCopy = document.getElementById('btn-copy');
  const btnDownload = document.getElementById('btn-download');
  const btnNewImage = document.getElementById('btn-new-image');

  // Application State
  let originalImage = null;
  let annotations = [];
  let undoStack = [];
  let redoStack = [];
  
  let currentTool = 'rect'; // 'select', 'rect', 'rounded-rect', 'circle', 'arrow', 'text', 'loupe', 'badge', 'mosaic'
  let currentColor = '#ef4444';
  let currentLineWidth = 6;
  let loupeZoom = 2.5;
  const LOUPE_TARGET_RADIUS = 65;
  let nextBadgeNumber = 1;
  let currentMaskType = 'pixel'; // 'pixel' | 'blur'

  let isDrawing = false;
  let dragStart = { x: 0, y: 0 };
  let currentMouse = { x: 0, y: 0 };
  let hoverCoords = null;
  let selectedIndex = -1;
  let isDraggingSelected = false;
  let dragOffset = { x: 0, y: 0 };

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service Worker registration failed:', err);
    });
  }

  // Toast Notification
  let toastTimer = null;
  function showToast(message) {
    toastMsg.textContent = message;
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  // Save State for Undo/Redo
  function pushState() {
    undoStack.push(JSON.stringify(annotations));
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    btnUndo.disabled = undoStack.length === 0;
    btnRedo.disabled = redoStack.length === 0;
    btnDelete.disabled = selectedIndex === -1;
  }

  // Image Loading
  function loadImage(fileOrBlob) {
    if (!fileOrBlob || !fileOrBlob.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください');
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        originalImage = img;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        annotations = [];
        undoStack = [];
        redoStack = [];
        selectedIndex = -1;
        nextBadgeNumber = 1;
        badgeCounterInput.value = nextBadgeNumber;

        dropzone.classList.add('is-hidden');
        canvasWrapper.classList.remove('is-hidden');
        statusInfo.textContent = `${img.naturalWidth} x ${img.naturalHeight} px`;
        
        render();
        updateHistoryButtons();
        showToast('画像を読み込みました');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(fileOrBlob);
  }

  // Paste from Clipboard
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (let item of items) {
      if (item.type.indexOf('image') !== -1) {
        const blob = item.getAsFile();
        loadImage(blob);
        e.preventDefault();
        return;
      }
    }
  });

  // Drag & Drop
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadImage(e.dataTransfer.files[0]);
    }
  });

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadImage(e.target.files[0]);
    }
  });

  btnNewImage.addEventListener('click', () => {
    if (confirm('現在の画像をリセットして新しい画像を開きますか？')) {
      dropzone.classList.remove('is-hidden');
      canvasWrapper.classList.add('is-hidden');
      originalImage = null;
      annotations = [];
      undoStack = [];
      redoStack = [];
      statusInfo.textContent = '画像未読込';
      updateHistoryButtons();
    }
  });

  // Coordinate Conversion (accounting for CSS scale)
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  // Render Loop
  function render(previewItem = null) {
    if (!originalImage) return;

    // 1. Clear & Draw base image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(originalImage, 0, 0);

    // 2. Render committed annotations
    for (let i = 0; i < annotations.length; i++) {
      const item = annotations[i];
      const isSelected = i === selectedIndex;
      drawAnnotation(ctx, item, isSelected);
    }

    // 3. Render active drag preview
    if (previewItem) {
      drawAnnotation(ctx, previewItem, false);
    }

    // 4. Render hover cursor preview when not dragging
    if (!isDrawing && hoverCoords) {
      drawHoverCursor(ctx, hoverCoords);
    }
  }

  // Draw Hover Guide Cursor (Loupe circle or Stamp badge)
  function drawHoverCursor(targetCtx, coords) {
    targetCtx.save();

    if (currentTool === 'loupe') {
      const sourceRadius = LOUPE_TARGET_RADIUS / loupeZoom;
      // 1. Solid white background outline for high contrast on any image
      targetCtx.beginPath();
      targetCtx.arc(coords.x, coords.y, sourceRadius, 0, Math.PI * 2);
      targetCtx.strokeStyle = '#ffffff';
      targetCtx.lineWidth = 4.5;
      targetCtx.setLineDash([]);
      targetCtx.stroke();

      // 2. High-visibility dashed colored circle on top of white border
      targetCtx.beginPath();
      targetCtx.arc(coords.x, coords.y, sourceRadius, 0, Math.PI * 2);
      targetCtx.strokeStyle = currentColor;
      targetCtx.setLineDash([6, 4]);
      targetCtx.lineWidth = 2.5;
      targetCtx.stroke();

      // Crosshair center dot with white outline
      targetCtx.beginPath();
      targetCtx.arc(coords.x, coords.y, 4, 0, Math.PI * 2);
      targetCtx.fillStyle = '#ffffff';
      targetCtx.fill();

      targetCtx.beginPath();
      targetCtx.arc(coords.x, coords.y, 2.5, 0, Math.PI * 2);
      targetCtx.fillStyle = currentColor;
      targetCtx.fill();
    } else if (currentTool === 'badge') {
      // Semi-transparent badge stamp preview
      targetCtx.globalAlpha = 0.75;
      drawBadge(targetCtx, {
        x: coords.x,
        y: coords.y,
        number: nextBadgeNumber,
        color: currentColor,
        lineWidth: currentLineWidth
      });
    }

    targetCtx.restore();
  }

  // Draw Individual Annotation
  function drawAnnotation(targetCtx, item, isSelected) {
    targetCtx.save();

    if (item.type === 'mosaic') {
      if (item.subType === 'blur') {
        drawBlur(targetCtx, item);
      } else {
        drawMosaic(targetCtx, item);
      }
    } else if (item.type === 'rect' || item.type === 'rounded-rect') {
      drawRect(targetCtx, item);
    } else if (item.type === 'circle') {
      drawCircle(targetCtx, item);
    } else if (item.type === 'arrow') {
      drawArrow(targetCtx, item);
    } else if (item.type === 'text') {
      drawText(targetCtx, item);
    } else if (item.type === 'badge') {
      drawBadge(targetCtx, item);
    } else if (item.type === 'loupe') {
      drawLoupe(targetCtx, item);
    }

    // Selection highlight border
    if (isSelected) {
      drawSelectionBox(targetCtx, item);
    }

    targetCtx.restore();
  }

  // Draw Rectangle / Rounded Rectangle
  function drawRect(ctx, item) {
    const x = Math.min(item.x, item.x + item.w);
    const y = Math.min(item.y, item.y + item.h);
    const w = Math.abs(item.w);
    const h = Math.abs(item.h);
    const r = item.type === 'rounded-rect' ? Math.min(16, w / 2, h / 2) : 0;

    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    if (r > 0) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.stroke();
  }

  // Draw Circle / Ellipse
  function drawCircle(ctx, item) {
    const rx = Math.abs(item.w / 2);
    const ry = Math.abs(item.h / 2);
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;

    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.lineWidth;

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Draw Arrow
   * Click point (x1, y1) = Arrow HEAD (Tip)
   * Drag end (x2, y2) = Arrow TAIL (Base)
   */
  function drawArrow(ctx, item) {
    const tipX = item.x1;
    const tipY = item.y1;
    const tailX = item.x2;
    const tailY = item.y2;

    const dx = tipX - tailX;
    const dy = tipY - tailY;
    const length = Math.hypot(dx, dy);
    if (length < 2) return;

    // Angle from tail to tip
    const angle = Math.atan2(dy, dx);
    const headLen = Math.max(16, item.lineWidth * 3.6);
    const headAngle = Math.PI / 6.5; // 27.7 degrees

    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = item.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Stop shaft slightly before the sharp tip so the stroke doesn't poke out
    const shaftEndX = tipX - (headLen * 0.5) * Math.cos(angle);
    const shaftEndY = tipY - (headLen * 0.5) * Math.sin(angle);

    // Draw main line
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Draw sleek arrow head (curved/indented base)
    const p1x = tipX - headLen * Math.cos(angle - headAngle);
    const p1y = tipY - headLen * Math.sin(angle - headAngle);
    const p2x = tipX - headLen * Math.cos(angle + headAngle);
    const p2y = tipY - headLen * Math.sin(angle + headAngle);
    const indentX = tipX - (headLen * 0.7) * Math.cos(angle);
    const indentY = tipY - (headLen * 0.7) * Math.sin(angle);

    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(p1x, p1y);
    ctx.lineTo(indentX, indentY);
    ctx.lineTo(p2x, p2y);
    ctx.closePath();
    ctx.fill();
  }

  // Draw Text with background plate
  function drawText(ctx, item) {
    const fontSize = Math.max(16, item.lineWidth * 4.5);
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    
    const lines = item.text.split('\n');
    let maxW = 0;
    for (let line of lines) {
      maxW = Math.max(maxW, ctx.measureText(line).width);
    }
    const lineHeight = fontSize * 1.35;
    const totalH = lineHeight * lines.length;
    const pad = 8;

    // Background badge
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(item.x - pad, item.y - pad, maxW + pad * 2, totalH + pad * 2, 6);
    ctx.fill();
    ctx.stroke();

    // Text content
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], item.x, item.y + i * lineHeight);
    }
  }

  // Draw Number Badge (supports 1, 2, 3+ digits with adaptive pill shape)
  function drawBadge(ctx, item) {
    const text = String(item.number);
    const baseRadius = Math.max(18, item.lineWidth * 3.2);
    const fontSize = baseRadius * 1.05;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const badgeW = Math.max(baseRadius * 2, textWidth + 14);
    const badgeH = baseRadius * 2;
    const rx = badgeH / 2;

    const left = item.x - badgeW / 2;
    const top = item.y - badgeH / 2;

    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;

    // Fill badge body
    ctx.fillStyle = item.color;
    ctx.beginPath();
    ctx.roundRect(left, top, badgeW, badgeH, rx);
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = 'transparent';

    // Outer white border for high visibility
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Number text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, item.x, item.y + 1);
  }

  // Draw Loupe (Callout Zoom with Connector Line)
  function drawLoupe(ctx, item) {
    const zoom = item.zoom || 2.5;
    const targetRadius = item.targetRadius || LOUPE_TARGET_RADIUS;
    const sourceRadius = targetRadius / zoom;

    // 1. Source Area Marker (Circle on original region)
    ctx.save();
    // 1-1. Thick solid white outline
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(item.sourceX, item.sourceY, sourceRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 1-2. High-contrast dashed colored circle
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(item.sourceX, item.sourceY, sourceRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 2. Connector Line (from source to target callout)
    ctx.save();
    // 2-1. Thick solid white outline for connector line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(item.sourceX, item.sourceY);
    ctx.lineTo(item.targetX, item.targetY);
    ctx.stroke();

    // 2-2. High-contrast dashed colored line
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(item.sourceX, item.sourceY);
    ctx.lineTo(item.targetX, item.targetY);
    ctx.stroke();
    ctx.restore();

    // 3. Zoom Lens Viewport
    ctx.save();
    // Drop shadow for the lens
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;

    ctx.beginPath();
    ctx.arc(item.targetX, item.targetY, targetRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.restore();

    // Clip to circle and draw zoomed original image
    ctx.save();
    ctx.beginPath();
    ctx.arc(item.targetX, item.targetY, targetRadius, 0, Math.PI * 2);
    ctx.clip();

    const sx = item.sourceX - sourceRadius;
    const sy = item.sourceY - sourceRadius;
    const sSize = sourceRadius * 2;
    const dx = item.targetX - targetRadius;
    const dy = item.targetY - targetRadius;
    const dSize = targetRadius * 2;

    ctx.drawImage(originalImage, sx, sy, sSize, sSize, dx, dy, dSize, dSize);
    ctx.restore();

    // 4. Lens Outer Ring (Dual border: Outer White + Inner Main Color)
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(item.targetX, item.targetY, targetRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = item.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(item.targetX, item.targetY, targetRadius - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Draw Pixelated Mosaic
  function drawMosaic(ctx, item) {
    const x = Math.min(item.x, item.x + item.w);
    const y = Math.min(item.y, item.y + item.h);
    const w = Math.abs(item.w);
    const h = Math.abs(item.h);
    if (w < 4 || h < 4) return;

    const blockSize = item.blockSize || 12;
    const offCanvas = document.createElement('canvas');
    const offW = Math.max(1, Math.floor(w / blockSize));
    const offH = Math.max(1, Math.floor(h / blockSize));
    offCanvas.width = offW;
    offCanvas.height = offH;
    const offCtx = offCanvas.getContext('2d');

    // Downscale
    offCtx.drawImage(originalImage, x, y, w, h, 0, 0, offW, offH);

    // Upscale without smoothing (nearest-neighbor)
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offCanvas, 0, 0, offW, offH, x, y, w, h);
    ctx.restore();

    // Subtle outline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  // Draw Blur Filter Mask
  function drawBlur(ctx, item) {
    const x = Math.min(item.x, item.x + item.w);
    const y = Math.min(item.y, item.y + item.h);
    const w = Math.abs(item.w);
    const h = Math.abs(item.h);
    if (w < 4 || h < 4) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.filter = 'blur(10px)';
    ctx.drawImage(originalImage, 0, 0);
    ctx.restore();

    // Subtle outline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  // Draw Selection Box around active item
  function drawSelectionBox(ctx, item) {
    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    const b = getItemBounds(item);
    const pad = 6;
    ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);

    // Corner handle
    ctx.fillStyle = '#06b6d4';
    ctx.fillRect(b.x + b.w + pad - 4, b.y + b.h + pad - 4, 8, 8);
    ctx.restore();
  }

  // Calculate bounding box for hit-testing and selection
  function getItemBounds(item) {
    if (item.type === 'rect' || item.type === 'rounded-rect' || item.type === 'mosaic') {
      return {
        x: Math.min(item.x, item.x + item.w),
        y: Math.min(item.y, item.y + item.h),
        w: Math.abs(item.w),
        h: Math.abs(item.h)
      };
    } else if (item.type === 'circle') {
      return {
        x: item.x,
        y: item.y,
        w: Math.abs(item.w),
        h: Math.abs(item.h)
      };
    } else if (item.type === 'arrow') {
      return {
        x: Math.min(item.x1, item.x2),
        y: Math.min(item.y1, item.y2),
        w: Math.max(20, Math.abs(item.x2 - item.x1)),
        h: Math.max(20, Math.abs(item.y2 - item.y1))
      };
    } else if (item.type === 'text') {
      const fontSize = Math.max(16, item.lineWidth * 4.5);
      const lines = item.text.split('\n');
      return {
        x: item.x - 8,
        y: item.y - 8,
        w: 160,
        h: fontSize * lines.length + 16
      };
    } else if (item.type === 'badge') {
      const r = Math.max(18, item.lineWidth * 3.2);
      return {
        x: item.x - r * 1.5,
        y: item.y - r,
        w: r * 3,
        h: r * 2
      };
    } else if (item.type === 'loupe') {
      const r = item.targetRadius || LOUPE_TARGET_RADIUS;
      return {
        x: Math.min(item.sourceX, item.targetX - r),
        y: Math.min(item.sourceY, item.targetY - r),
        w: Math.max(item.sourceX, item.targetX + r) - Math.min(item.sourceX, item.targetX - r),
        h: Math.max(item.sourceY, item.targetY + r) - Math.min(item.sourceY, item.targetY - r)
      };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  // Hit testing for selection
  function hitTest(x, y) {
    for (let i = annotations.length - 1; i >= 0; i--) {
      const b = getItemBounds(annotations[i]);
      const pad = 10;
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) {
        return i;
      }
    }
    return -1;
  }

  // Hover tracking for stamp/loupe previews
  canvas.addEventListener('mousemove', (e) => {
    if (!originalImage || isDrawing) return;
    hoverCoords = getCanvasCoords(e);
    if (currentTool === 'loupe' || currentTool === 'badge') {
      render();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoverCoords = null;
    if (currentTool === 'loupe' || currentTool === 'badge') {
      render();
    }
  });

  // Mouse / Touch Event Handlers
  canvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);

  function onPointerDown(e) {
    if (!originalImage) return;
    const coords = getCanvasCoords(e);
    dragStart = coords;
    currentMouse = coords;
    isDrawing = true;

    if (currentTool === 'select') {
      const hit = hitTest(coords.x, coords.y);
      selectedIndex = hit;
      if (hit !== -1) {
        isDraggingSelected = true;
        dragOffset = { x: coords.x, y: coords.y };
      }
      updateHistoryButtons();
      render();
      return;
    }

    if (currentTool === 'badge') {
      pushState();
      annotations.push({
        type: 'badge',
        x: coords.x,
        y: coords.y,
        number: nextBadgeNumber,
        color: currentColor,
        lineWidth: currentLineWidth
      });
      nextBadgeNumber++;
      badgeCounterInput.value = nextBadgeNumber;
      isDrawing = false;
      render();
      return;
    }

    if (currentTool === 'text') {
      if (e.cancelable) e.preventDefault();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      openTextEditor(clientX, clientY, coords.x, coords.y);
      isDrawing = false;
      return;
    }
  }

  function onPointerMove(e) {
    if (!isDrawing || !originalImage) return;
    const coords = getCanvasCoords(e);
    currentMouse = coords;

    if (currentTool === 'select' && isDraggingSelected && selectedIndex !== -1) {
      const dx = coords.x - dragOffset.x;
      const dy = coords.y - dragOffset.y;
      moveItem(annotations[selectedIndex], dx, dy);
      dragOffset = coords;
      render();
      return;
    }

    // Prepare preview
    let preview = null;
    const w = coords.x - dragStart.x;
    const h = coords.y - dragStart.y;

    if (currentTool === 'rect' || currentTool === 'rounded-rect') {
      preview = {
        type: currentTool,
        x: dragStart.x,
        y: dragStart.y,
        w: w,
        h: h,
        color: currentColor,
        lineWidth: currentLineWidth
      };
    } else if (currentTool === 'circle') {
      preview = {
        type: 'circle',
        x: dragStart.x,
        y: dragStart.y,
        w: w,
        h: h,
        color: currentColor,
        lineWidth: currentLineWidth
      };
    } else if (currentTool === 'arrow') {
      // dragStart = Arrow Tip, coords = Arrow Tail
      preview = {
        type: 'arrow',
        x1: dragStart.x,
        y1: dragStart.y,
        x2: coords.x,
        y2: coords.y,
        color: currentColor,
        lineWidth: currentLineWidth
      };
    } else if (currentTool === 'loupe') {
      preview = {
        type: 'loupe',
        sourceX: dragStart.x,
        sourceY: dragStart.y,
        targetX: coords.x,
        targetY: coords.y,
        targetRadius: LOUPE_TARGET_RADIUS,
        zoom: loupeZoom,
        color: currentColor,
        lineWidth: currentLineWidth
      };
    } else if (currentTool === 'mosaic') {
      preview = {
        type: 'mosaic',
        subType: currentMaskType,
        x: dragStart.x,
        y: dragStart.y,
        w: w,
        h: h,
        blockSize: 12
      };
    }

    render(preview);
  }

  function onPointerUp(e) {
    if (!isDrawing || !originalImage) return;
    isDrawing = false;
    isDraggingSelected = false;

    if (currentTool === 'select') return;

    const w = currentMouse.x - dragStart.x;
    const h = currentMouse.y - dragStart.y;
    const dist = Math.hypot(w, h);

    // Minimum drag threshold to prevent accidental clicks
    if (dist < 5 && currentTool !== 'badge' && currentTool !== 'text') {
      render();
      return;
    }

    pushState();

    if (currentTool === 'rect' || currentTool === 'rounded-rect') {
      annotations.push({
        type: currentTool,
        x: dragStart.x,
        y: dragStart.y,
        w: w,
        h: h,
        color: currentColor,
        lineWidth: currentLineWidth
      });
    } else if (currentTool === 'circle') {
      annotations.push({
        type: 'circle',
        x: dragStart.x,
        y: dragStart.y,
        w: w,
        h: h,
        color: currentColor,
        lineWidth: currentLineWidth
      });
    } else if (currentTool === 'arrow') {
      annotations.push({
        type: 'arrow',
        x1: dragStart.x,
        y1: dragStart.y,
        x2: currentMouse.x,
        y2: currentMouse.y,
        color: currentColor,
        lineWidth: currentLineWidth
      });
    } else if (currentTool === 'loupe') {
      annotations.push({
        type: 'loupe',
        sourceX: dragStart.x,
        sourceY: dragStart.y,
        targetX: currentMouse.x,
        targetY: currentMouse.y,
        targetRadius: LOUPE_TARGET_RADIUS,
        zoom: loupeZoom,
        color: currentColor,
        lineWidth: currentLineWidth
      });
    } else if (currentTool === 'mosaic') {
      annotations.push({
        type: 'mosaic',
        subType: currentMaskType,
        x: dragStart.x,
        y: dragStart.y,
        w: w,
        h: h,
        blockSize: 12
      });
    }

    render();
  }

  function moveItem(item, dx, dy) {
    if (item.type === 'arrow') {
      item.x1 += dx;
      item.y1 += dy;
      item.x2 += dx;
      item.y2 += dy;
    } else if (item.type === 'loupe') {
      item.sourceX += dx;
      item.sourceY += dy;
      item.targetX += dx;
      item.targetY += dy;
    } else {
      item.x += dx;
      item.y += dy;
    }
  }

  // In-place Text Editor
  let textCanvasCoords = { x: 0, y: 0 };
  let isComposingText = false;
  let textEditorOpenTime = 0;

  function openTextEditor(clientX, clientY, canvasX, canvasY) {
    if (!textEditorContainer.classList.contains('is-hidden')) {
      commitText();
    }

    textCanvasCoords = { x: canvasX, y: canvasY };
    const rect = canvas.getBoundingClientRect();
    let left = clientX - rect.left;
    let top = clientY - rect.top;

    // Keep container within canvas visible bounds
    const maxLeft = Math.max(0, rect.width - 250);
    const maxTop = Math.max(0, rect.height - 110);
    left = Math.min(Math.max(0, left), maxLeft);
    top = Math.min(Math.max(0, top), maxTop);

    textEditorContainer.style.left = `${left}px`;
    textEditorContainer.style.top = `${top}px`;
    textEditorContainer.style.borderColor = currentColor;
    textEditorContainer.classList.remove('is-hidden');

    textEditor.value = '';
    textEditorOpenTime = Date.now();

    // Focus immediately and ensure focus with a short delay for browser reliability
    textEditor.focus();
    setTimeout(() => {
      textEditor.focus();
    }, 40);
  }

  function commitText() {
    if (textEditorContainer.classList.contains('is-hidden')) return;
    const text = textEditor.value.trim();
    if (text.length > 0) {
      pushState();
      annotations.push({
        type: 'text',
        x: textCanvasCoords.x,
        y: textCanvasCoords.y,
        text: text,
        color: currentColor,
        lineWidth: currentLineWidth
      });
      render();
    }
    closeTextEditor();
  }

  function closeTextEditor() {
    textEditorContainer.classList.add('is-hidden');
    textEditor.value = '';
  }

  // Buttons inside text editor toolbar
  btnTextOk.addEventListener('click', (e) => {
    e.stopPropagation();
    commitText();
  });

  btnTextCancel.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTextEditor();
  });

  // Auto-resize textarea to fit content
  textEditor.addEventListener('input', () => {
    textEditor.style.height = 'auto';
    textEditor.style.height = `${Math.max(48, textEditor.scrollHeight)}px`;
  });

  // IME composition tracking
  textEditor.addEventListener('compositionstart', () => {
    isComposingText = true;
  });

  textEditor.addEventListener('compositionend', () => {
    isComposingText = false;
  });

  textEditor.addEventListener('keydown', (e) => {
    // If user is currently composing with an IME (e.g. Japanese kanji selection), ignore Enter
    if (e.isComposing || isComposingText || e.keyCode === 229) {
      return;
    }

    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Allow multi-line input on Shift+Enter
        return;
      }
      e.preventDefault();
      commitText();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeTextEditor();
    }
  });

  textEditor.addEventListener('blur', (e) => {
    // Ignore blur if it happened immediately after opening (caused by mouseup or browser focus transition)
    if (Date.now() - textEditorOpenTime < 350) {
      return;
    }
    // If clicking OK or Cancel button within the container, do not auto-commit on blur
    if (e.relatedTarget && textEditorContainer.contains(e.relatedTarget)) {
      return;
    }
    if (!textEditorContainer.classList.contains('is-hidden')) {
      commitText();
    }
  });

  // Prevent interactions inside text editor from triggering canvas drawing or bubbling
  ['mousedown', 'touchstart', 'pointerdown', 'click'].forEach(evt => {
    textEditorContainer.addEventListener(evt, (e) => {
      e.stopPropagation();
    });
  });

  // Undo / Redo / Delete
  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(annotations));
    const previous = undoStack.pop();
    annotations = JSON.parse(previous);
    selectedIndex = -1;
    render();
    updateHistoryButtons();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(annotations));
    const next = redoStack.pop();
    annotations = JSON.parse(next);
    selectedIndex = -1;
    render();
    updateHistoryButtons();
  }

  function deleteSelected() {
    if (selectedIndex === -1) return;
    pushState();
    annotations.splice(selectedIndex, 1);
    selectedIndex = -1;
    render();
    updateHistoryButtons();
  }

  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnDelete.addEventListener('click', deleteSelected);

  window.addEventListener('keydown', (e) => {
    if (!textEditorContainer.classList.contains('is-hidden')) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedIndex !== -1) {
        e.preventDefault();
        deleteSelected();
      }
    }
  });

  // Tool Selection
  const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
  toolButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      toolButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.getAttribute('data-tool');

      canvas.className = '';
      if (currentTool === 'select') canvas.classList.add('tool-select');
      else if (currentTool === 'text') canvas.classList.add('tool-text');

      // Toggle tool-specific options
      badgeOptions.classList.toggle('is-hidden', currentTool !== 'badge');
      loupeOptions.classList.toggle('is-hidden', currentTool !== 'loupe');
      mosaicOptions.classList.toggle('is-hidden', currentTool !== 'mosaic');

      selectedIndex = -1;
      updateHistoryButtons();
      render();
    });
  });

  // Mask Type Selection (Mosaic vs Blur)
  maskTypeSelect.addEventListener('change', (e) => {
    currentMaskType = e.target.value;
  });

  // Color Selection
  const colorDots = document.querySelectorAll('.color-dot');
  const customColorInput = document.getElementById('custom-color');
  colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
      colorDots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      currentColor = dot.getAttribute('data-color');
      render();
    });
  });

  customColorInput.addEventListener('input', (e) => {
    colorDots.forEach(d => d.classList.remove('active'));
    currentColor = e.target.value;
    render();
  });

  // Line Width Selection
  const widthButtons = document.querySelectorAll('.width-btn');
  widthButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      widthButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLineWidth = parseInt(btn.getAttribute('data-width'), 10);
      render();
    });
  });

  // Loupe Zoom Selection
  loupeZoomSelect.addEventListener('change', (e) => {
    loupeZoom = parseFloat(e.target.value);
    render();
  });

  // Badge Counter Input & Reset
  badgeCounterInput.addEventListener('change', (e) => {
    nextBadgeNumber = Math.max(1, parseInt(e.target.value, 10) || 1);
    render();
  });

  document.getElementById('btn-reset-badge').addEventListener('click', () => {
    nextBadgeNumber = 1;
    badgeCounterInput.value = 1;
    showToast('連番カウンターを 1 にリセットしました');
    render();
  });

  // Export: Copy to Clipboard
  btnCopy.addEventListener('click', async () => {
    if (!originalImage) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          showToast('画像生成に失敗しました');
          return;
        }
        if (navigator.clipboard && navigator.clipboard.write) {
          const item = new ClipboardItem({ 'image/png': blob });
          await navigator.clipboard.write([item]);
          showToast('📋 クリップボードに画像をコピーしました！');
        } else {
          showToast('お使いの環境では直接コピーがサポートされていません。保存をご利用ください');
        }
      }, 'image/png');
    } catch (err) {
      console.error('Clipboard copy error:', err);
      showToast('クリップボードへのコピーに失敗しました');
    }
  });

  // Export: Download PNG
  btnDownload.addEventListener('click', () => {
    if (!originalImage) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      const timeStr = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
      a.download = `annotated_${timeStr}.png`;
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      showToast('💾 画像をダウンロードしました');
    }, 'image/png');
  });

})();
