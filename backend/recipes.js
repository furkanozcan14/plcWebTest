/**
 * recipes.js — Faz 3: Reçete Motoru
 * Test senaryolarının (recipes) yönetimi (CRUD) ve yürütülmesi.
 */

const fs = require('fs');
const path = require('path');

const RECIPES_PATH = path.join(__dirname, 'recipes.json');

class RecipeManager {
  constructor(plcState, modbusClient, io, broadcastLog) {
    this.plcState = plcState;
    this.modbusClient = modbusClient;
    this.io = io;
    this.broadcastLog = broadcastLog;
    
    this.recipes = this.loadRecipes();
    this.runningRecipe = null;
    this.abortController = null;
  }

  loadRecipes() {
    try {
      if (fs.existsSync(RECIPES_PATH)) {
        const data = fs.readFileSync(RECIPES_PATH, 'utf8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error(`[RECIPE] recipes.json okuma hatası: ${err.message}`);
    }
    this.saveRecipes([]);
    return [];
  }

  saveRecipes(recipes) {
    try {
      fs.writeFileSync(RECIPES_PATH, JSON.stringify(recipes, null, 2), 'utf8');
    } catch (err) {
      console.error(`[RECIPE] recipes.json yazma hatası: ${err.message}`);
    }
  }

  getRecipes() {
    return this.recipes;
  }

  addRecipe(recipe) {
    recipe.id = Date.now().toString();
    this.recipes.push(recipe);
    this.saveRecipes(this.recipes);
    return recipe;
  }

  updateRecipe(id, updatedRecipe) {
    const idx = this.recipes.findIndex(r => r.id === id);
    if (idx !== -1) {
      this.recipes[idx] = { ...updatedRecipe, id };
      this.saveRecipes(this.recipes);
      return this.recipes[idx];
    }
    return null;
  }

  deleteRecipe(id) {
    const idx = this.recipes.findIndex(r => r.id === id);
    if (idx !== -1) {
      this.recipes.splice(idx, 1);
      this.saveRecipes(this.recipes);
      return true;
    }
    return false;
  }

  async runRecipe(id) {
    if (this.runningRecipe) {
      throw new Error('Şu anda başka bir reçete çalışıyor.');
    }
    
    const recipe = this.recipes.find(r => r.id === id);
    if (!recipe) {
      throw new Error('Reçete bulunamadı.');
    }

    if (!this.plcState.running) {
      throw new Error('Reçeteyi çalıştırmak için sistem START durumunda olmalıdır.');
    }

    this.runningRecipe = recipe;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.broadcastLog(`[RECIPE] "${recipe.name}" senaryosu başlatıldı.`);
    this.io.emit('recipe:status', { running: true, recipeId: recipe.id, stepIndex: 0, totalSteps: recipe.steps.length });

    try {
      for (let i = 0; i < recipe.steps.length; i++) {
        if (signal.aborted) throw new Error('ABORTED');

        const step = recipe.steps[i];
        this.io.emit('recipe:status', { running: true, recipeId: recipe.id, stepIndex: i, totalSteps: recipe.steps.length, currentStep: step });
        
        // Find tag
        const tag = this.plcState.tags.find(t => t.id === parseInt(step.tagId, 10));
        if (tag) {
          this.broadcastLog(`[RECIPE] Adım ${i+1}: ${tag.name} = ${step.targetValue} ayarlanıyor...`);
          
          if (this.plcState.simulationMode) {
             let numVal = parseFloat(step.targetValue);
             if (tag.type === 'coil') {
               tag.value = (step.targetValue === '1' || step.targetValue === 1 || step.targetValue === true) ? 1 : 0;
             } else {
               if (tag.min !== undefined && numVal < tag.min) numVal = tag.min;
               if (tag.max !== undefined && numVal > tag.max) numVal = tag.max;
               tag.value = numVal;
             }
             this.plcState.simValues[tag.id] = tag.value;
             this.broadcastLog(`[RECIPE] Yazıldı (SIM): ${tag.name} = ${tag.value}`);
          } else {
             const result = await this.modbusClient.writeTagValue(tag, step.targetValue);
             if (result.success) {
                tag.value = result.value;
                this.broadcastLog(`[RECIPE] Yazıldı: ${tag.name} = ${tag.value}`);
             } else {
                this.broadcastLog(`[RECIPE] [ERR] Adım ${i+1} yazılamadı: ${result.error}`);
             }
          }
        } else {
          this.broadcastLog(`[RECIPE] [WARNING] Adım ${i+1}: Tag ID ${step.tagId} bulunamadı.`);
        }

        // Wait delayMs
        const delay = parseInt(step.delayMs, 10) || 0;
        if (delay > 0) {
          this.broadcastLog(`[RECIPE] Adım ${i+1}: ${delay}ms bekleniyor...`);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('ABORTED'));
            }, { once: true });
          });
        }
      }
      this.broadcastLog(`[RECIPE] "${recipe.name}" senaryosu tamamlandı.`);
    } catch (err) {
      if (err.message === 'ABORTED') {
        this.broadcastLog(`[RECIPE] "${recipe.name}" iptal edildi.`);
      } else {
        this.broadcastLog(`[RECIPE] Hata: ${err.message}`);
      }
    } finally {
      this.runningRecipe = null;
      this.abortController = null;
      this.io.emit('recipe:status', { running: false, recipeId: null, stepIndex: 0, totalSteps: 0 });
    }
  }

  stopRecipe() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

module.exports = { RecipeManager };
