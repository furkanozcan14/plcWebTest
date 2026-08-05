/**
 * recipes.js — Faz 3: Frontend Reçete Motoru
 */

let recipes = [];
let currentSteps = []; // for the new recipe form
let isRecipeRunning = false;

async function loadRecipes() {
  try {
    const res = await fetch('/api/recipes');
    const data = await res.json();
    if (data.success) {
      recipes = data.recipes;
      updateRecipeSelect();
    }
  } catch (err) {
    console.log('[RECIPE] Yüklenemedi:', err);
  }
}

function updateRecipeSelect() {
  const select = document.getElementById('recipe-select');
  if (!select) return;
  select.innerHTML = '<option value="">-- Senaryo Seçin --</option>';
  recipes.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  });
}

// ─── Senaryo Form Yönetimi ──────────────────────────────────────────────────
function showRecipeForm() {
  document.getElementById('recipe-form-container').style.display = 'block';
  document.getElementById('recipe-name').value = '';
  currentSteps = [];
  renderRecipeSteps();
}

function hideRecipeForm() {
  document.getElementById('recipe-form-container').style.display = 'none';
}

function renderRecipeSteps() {
  const container = document.getElementById('recipe-steps-container');
  container.innerHTML = '';
  
  if (currentSteps.length === 0) {
    container.innerHTML = '<div style="font-size:11px;color:var(--text-muted);text-align:center;">Henüz adım eklenmedi.</div>';
    return;
  }

  currentSteps.forEach((step, idx) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex; gap:5px; align-items:center; background:rgba(255,255,255,0.02); padding:5px; border-radius:4px;';
    
    // Tag select
    let options = tbState.tags.map(t => `<option value="${t.id}" ${step.tagId == t.id ? 'selected' : ''}>${t.name} (${t.type==='register'?'D':'M'}${t.address})</option>`).join('');
    
    div.innerHTML = `
      <span style="font-family:var(--font-mono);font-size:10px;width:15px;color:var(--text-secondary);">${idx+1}.</span>
      <select class="form-input" style="flex:2;padding:4px;" onchange="updateStep(${idx}, 'tagId', this.value)">
        <option value="">Tag Seç...</option>
        ${options}
      </select>
      <input class="form-input" style="flex:1;padding:4px;" type="number" placeholder="Değer" value="${step.targetValue}" oninput="updateStep(${idx}, 'targetValue', this.value)">
      <input class="form-input" style="flex:1;padding:4px;" type="number" placeholder="Bekle(ms)" value="${step.delayMs}" oninput="updateStep(${idx}, 'delayMs', this.value)">
      <button class="btn btn-sm btn-ghost" style="color:var(--red);padding:4px;" onclick="removeStep(${idx})"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
    `;
    container.appendChild(div);
  });
  if (window.lucide) lucide.createIcons();
}

window.updateStep = function(idx, field, value) {
  if (currentSteps[idx]) currentSteps[idx][field] = value;
};
window.removeStep = function(idx) {
  currentSteps.splice(idx, 1);
  renderRecipeSteps();
};

async function saveRecipe() {
  const name = document.getElementById('recipe-name').value.trim();
  if (!name) { alert('Senaryo adı gereklidir.'); return; }
  if (currentSteps.length === 0) { alert('En az bir adım eklemelisiniz.'); return; }
  for (let s of currentSteps) {
    if (!s.tagId || s.targetValue === '') { alert('Tüm adımlardaki Tag ve Değer alanları doldurulmalıdır.'); return; }
  }

  const recipe = { name, steps: currentSteps };
  try {
    await fetch('/api/recipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe)
    });
    hideRecipeForm();
    await loadRecipes();
  } catch (err) { alert('Kaydedilemedi'); }
}

async function deleteRecipe() {
  const select = document.getElementById('recipe-select');
  const id = select.value;
  if (!id) return;
  if (!confirm('Senaryoyu silmek istediğinize emin misiniz?')) return;
  
  try {
    await fetch(`/api/recipes/${id}`, { method: 'DELETE' });
    await loadRecipes();
  } catch(err) { alert('Silinemedi'); }
}

// ─── Çalıştırma ─────────────────────────────────────────────────────────────
async function runRecipe() {
  const select = document.getElementById('recipe-select');
  const id = select.value;
  if (!id) return;
  if (!tbState.running) {
    alert('Reçeteyi çalıştırmak için önce sistemi (START) başlatmalısınız.');
    return;
  }
  
  try {
    const res = await fetch(`/api/recipes/${id}/run`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) alert('Başlatılamadı: ' + data.error);
  } catch (err) {}
}

async function stopRecipe() {
  try {
    await fetch('/api/recipes/stop', { method: 'POST' });
  } catch (err) {}
}

// ─── Socket Events (testbench.js içinden çağrılacak veya global dinlenecek) ──
function initRecipeSocket(socket) {
  socket.on('recipe:status', (data) => {
    isRecipeRunning = data.running;
    
    document.getElementById('btn-run-recipe').disabled = isRecipeRunning;
    document.getElementById('btn-stop-recipe').disabled = !isRecipeRunning;
    document.getElementById('btn-delete-recipe').disabled = isRecipeRunning;
    document.getElementById('recipe-select').disabled = isRecipeRunning;
    
    const bar = document.getElementById('recipe-status-bar');
    const text = document.getElementById('recipe-status-text');
    
    if (isRecipeRunning) {
      bar.style.display = 'block';
      let tagInfo = '';
      if (data.currentStep) {
        const tag = tbState.tags.find(t => t.id == data.currentStep.tagId);
        tagInfo = tag ? `${tag.name} = ${data.currentStep.targetValue}` : '';
      }
      text.textContent = `Adım ${data.stepIndex + 1}/${data.totalSteps} — ${tagInfo}`;
    } else {
      bar.style.display = 'none';
    }
  });
}

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('btn-new-recipe')) {
    document.getElementById('btn-new-recipe').addEventListener('click', showRecipeForm);
    document.getElementById('btn-add-recipe-step').addEventListener('click', () => {
      currentSteps.push({ tagId: '', targetValue: '', delayMs: '1000' });
      renderRecipeSteps();
    });
    document.getElementById('btn-save-recipe').addEventListener('click', saveRecipe);
    document.getElementById('btn-cancel-recipe').addEventListener('click', hideRecipeForm);
    
    document.getElementById('btn-run-recipe').addEventListener('click', runRecipe);
    document.getElementById('btn-stop-recipe').addEventListener('click', stopRecipe);
    document.getElementById('btn-delete-recipe').addEventListener('click', deleteRecipe);
    
    loadRecipes();
  }
});
