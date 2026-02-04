import { LitElement, html } from 'lit';
import { settingsPanelStyles } from './SettingsPanelStyles.js';
import { renderSettingsPanel } from './SettingsPanelTemplate.js';
import { RpcMixin } from '../utils/rpc.js';

/**
 * Settings panel for config file editing and reloading.
 * 
 * Config files are edited in the main diff viewer by dispatching
 * a 'config-edit-request' event that AppShell handles.
 */
export class SettingsPanel extends RpcMixin(LitElement) {
  static properties = {
    visible: { type: Boolean },
    configInfo: { type: Object },
    isLoading: { type: Boolean },
    message: { type: Object }, // { type: 'success' | 'error', text: string }
  };

  static styles = settingsPanelStyles;

  constructor() {
    super();
    this.visible = false;
    this.configInfo = null;
    this.isLoading = false;
    this.message = null;
    this._messageTimeout = null;
  }

  onRpcReady() {
    this.loadConfigInfo();
  }

  async loadConfigInfo() {
    if (!this.rpcCall) {
      console.warn('loadConfigInfo called but rpcCall not set');
      return;
    }
    try {
      this.isLoading = true;
      const result = await this._rpcExtract('Settings.get_config_info');
      if (result?.success) {
        this.configInfo = result;
      } else {
        console.error('Failed to load config info:', result);
      }
    } catch (e) {
      console.error('Failed to load config info:', e);
    } finally {
      this.isLoading = false;
    }
  }

  editConfig(configType) {
    // Dispatch event for AppShell to load config into diff viewer
    this.dispatchEvent(new CustomEvent('config-edit-request', {
      bubbles: true,
      composed: true,
      detail: { configType }
    }));
  }

  async reloadLlmConfig() {
    try {
      this.isLoading = true;
      const result = await this._rpcExtract('Settings.reload_llm_config');
      if (result?.success) {
        this._showMessage('success', result.message || 'LLM config reloaded');
        // Update displayed config info
        this.configInfo = {
          ...this.configInfo,
          model: result.model,
          smaller_model: result.smaller_model,
        };
      } else {
        this._showMessage('error', result?.error || 'Failed to reload config');
      }
    } catch (e) {
      this._showMessage('error', e.message || 'Failed to reload config');
    } finally {
      this.isLoading = false;
    }
  }

  async reloadAppConfig() {
    try {
      this.isLoading = true;
      const result = await this._rpcExtract('Settings.reload_app_config');
      if (result?.success) {
        this._showMessage('success', result.message || 'App config reloaded');
      } else {
        this._showMessage('error', result?.error || 'Failed to reload config');
      }
    } catch (e) {
      this._showMessage('error', e.message || 'Failed to reload config');
    } finally {
      this.isLoading = false;
    }
  }

  _showMessage(type, text) {
    this.message = { type, text };
    
    // Clear any existing timeout
    if (this._messageTimeout) {
      clearTimeout(this._messageTimeout);
    }
    
    // Auto-dismiss after 3 seconds
    this._messageTimeout = setTimeout(() => {
      this.message = null;
    }, 3000);
  }

  dismissMessage() {
    this.message = null;
    if (this._messageTimeout) {
      clearTimeout(this._messageTimeout);
      this._messageTimeout = null;
    }
  }

  render() {
    return renderSettingsPanel(this);
  }
}

customElements.define('settings-panel', SettingsPanel);
