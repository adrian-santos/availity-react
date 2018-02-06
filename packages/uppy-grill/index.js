import dragDrop from 'drag-drop';
import prettyBytes from 'prettier-bytes';
import Plugin from 'uppy/lib/core/Plugin';
import Translator from 'uppy/lib/core/Translator';
import ThumbnailGenerator from 'uppy/lib/plugins/ThumbnailGenerator';
import StatusBar from 'uppy/lib/plugins/StatusBar';
import Informer from 'uppy/lib/plugins/Informer';
import { findAllDOMElements, toArray } from 'uppy/lib/core/Utils';
import { defaultTabIcon } from 'uppy/lib/plugins/Dashboard/icons';
import GrillUI from './Grill';

// most of this code was taken from https://github.com/transloadit/uppy
// MIT licence, https://github.com/transloadit/uppy/blob/master/LICENSE
// Copyright (c) 2018 Transloadit

// Some code for managing focus was adopted from https://github.com/ghosh/micromodal
// MIT licence, https://github.com/ghosh/micromodal/blob/master/LICENSE.md
// Copyright (c) 2017 Indrashish Ghosh
const FOCUSABLE_ELEMENTS = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"]):not([aria-hidden])',
  'select:not([disabled]):not([aria-hidden])',
  'textarea:not([disabled]):not([aria-hidden])',
  'button:not([disabled]):not([aria-hidden])',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]:not([tabindex^="-"])',
];

/**
 * Grill UI with previews, metadata editing, tabs for various services and more
 */
class Grill extends Plugin {
  constructor(uppy, opts) {
    super(uppy, opts);
    this.id = this.opts.id || 'Grill';
    this.title = 'Grill';
    this.type = 'orchestrator';

    const defaultLocale = {
      strings: {
        selectToUpload: 'Select files to upload',
        closeModal: 'Close Modal',
        upload: 'Upload',
        importFrom: 'Import files from',
        GrillWindowTitle: 'Uppy Grill Window (Press escape to close)',
        GrillTitle: 'Uppy Grill',
        copyLinkToClipboardSuccess: 'Link copied to clipboard.',
        copyLinkToClipboardFallback: 'Copy the URL below',
        copyLink: 'Copy link',
        fileSource: 'File source',
        done: 'Done',
        name: 'Name',
        removeFile: 'Remove file',
        editFile: 'Edit file',
        editing: 'Editing',
        finishEditingFile: 'Finish editing file',
        localDisk: 'Local Disk',
        myDevice: 'My Device',
        dropPasteImport:
          'Drop files here, paste, import from one of the locations above or',
        dropPaste: 'Drop files here, paste or',
        browse: 'browse',
        fileProgress: 'File progress: upload speed and ETA',
        numberOfSelectedFiles: 'Number of selected files',
        uploadAllNewFiles: 'Upload all new files',
        emptyFolderAdded: 'No files were added from empty folder',
        uploadXFiles: {
          0: 'Upload %{smart_count} file',
          1: 'Upload %{smart_count} files',
        },
        uploadXNewFiles: {
          0: 'Upload +%{smart_count} file',
          1: 'Upload +%{smart_count} files',
        },
        folderAdded: {
          0: 'Added %{smart_count} file from %{folder}',
          1: 'Added %{smart_count} files from %{folder}',
        },
      },
    };

    // set default options
    const defaultOptions = {
      target: 'body',
      metaFields: [],
      trigger: '#uppy-select-files',
      inline: false,
      width: 750,
      height: 550,
      thumbnailWidth: 280,
      defaultTabIcon,
      showProgressDetails: false,
      hideUploadButton: false,
      hideProgressAfterFinish: false,
      note: null,
      closeModalOnClickOutside: false,
      disableStatusBar: false,
      disableInformer: false,
      disableThumbnailGenerator: false,
      disablePageScrollWhenModalOpen: true,
      onRequestCloseModal: () => this.closeModal(),
      locale: defaultLocale,
    };

    // merge default options with the ones set by user
    this.opts = Object.assign({}, defaultOptions, opts);

    this.locale = Object.assign({}, defaultLocale, this.opts.locale);
    this.locale.strings = Object.assign(
      {},
      defaultLocale.strings,
      this.opts.locale.strings
    );

    this.translator = new Translator({ locale: this.locale });
    this.i18n = this.translator.translate.bind(this.translator);

    this.openModal = this.openModal.bind(this);
    this.closeModal = this.closeModal.bind(this);
    this.requestCloseModal = this.requestCloseModal.bind(this);
    this.isModalOpen = this.isModalOpen.bind(this);

    this.addTarget = this.addTarget.bind(this);
    this.hideAllPanels = this.hideAllPanels.bind(this);
    this.showPanel = this.showPanel.bind(this);
    this.getFocusableNodes = this.getFocusableNodes.bind(this);
    this.setFocusToFirstNode = this.setFocusToFirstNode.bind(this);
    this.maintainFocus = this.maintainFocus.bind(this);

    this.initEvents = this.initEvents.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
    this.handleClickOutside = this.handleClickOutside.bind(this);
    this.handleFileCard = this.handleFileCard.bind(this);
    this.handleDrop = this.handleDrop.bind(this);
    this.handlePaste = this.handlePaste.bind(this);
    this.handleInputChange = this.handleInputChange.bind(this);
    this.updateGrillElWidth = this.updateGrillElWidth.bind(this);
    this.render = this.render.bind(this);
    this.install = this.install.bind(this);
  }

  addTarget(plugin) {
    const callerPluginId = plugin.id || plugin.constructor.name;
    const callerPluginName = plugin.title || callerPluginId;
    const callerPluginType = plugin.type;

    if (
      callerPluginType !== 'acquirer' &&
      callerPluginType !== 'progressindicator' &&
      callerPluginType !== 'presenter'
    ) {
      const msg =
        'Grill: Modal can only be used by plugins of types: acquirer, progressindicator, presenter';
      this.uppy.log(msg);
      return;
    }

    const target = {
      id: callerPluginId,
      name: callerPluginName,
      type: callerPluginType,
    };

    const state = this.getPluginState();
    const newTargets = state.targets.slice();
    newTargets.push(target);

    this.setPluginState({
      targets: newTargets,
    });

    return this.el;
  }

  hideAllPanels() {
    this.setPluginState({
      activePanel: false,
    });
  }

  showPanel(id) {
    const { targets } = this.getPluginState();

    const activePanel = targets.filter(
      target => target.type === 'acquirer' && target.id === id
    )[0];

    this.setPluginState({
      activePanel,
    });
  }

  requestCloseModal() {
    if (this.opts.onRequestCloseModal) {
      return this.opts.onRequestCloseModal();
    }
    this.closeModal();
  }

  getFocusableNodes() {
    const nodes = this.el.querySelectorAll(FOCUSABLE_ELEMENTS);
    return Object.keys(nodes).map(key => nodes[key]);
  }

  setFocusToFirstNode() {
    const focusableNodes = this.getFocusableNodes();
    if (focusableNodes.length) focusableNodes[0].focus();
  }

  maintainFocus(event) {
    const focusableNodes = this.getFocusableNodes();
    const focusedItemIndex = focusableNodes.indexOf(document.activeElement);

    if (event.shiftKey && focusedItemIndex === 0) {
      focusableNodes[focusableNodes.length - 1].focus();
      event.preventDefault();
    }

    if (!event.shiftKey && focusedItemIndex === focusableNodes.length - 1) {
      focusableNodes[0].focus();
      event.preventDefault();
    }
  }

  openModal() {
    this.setPluginState({
      isHidden: false,
    });

    // save scroll position
    this.savedScrollPosition = window.scrollY;
    // save active element, so we can restore focus when modal is closed
    this.savedActiveElement = document.activeElement;

    if (this.opts.disablePageScrollWhenModalOpen) {
      document.body.classList.add('uppy-Grill-isOpen');
    }

    this.updateGrillElWidth();
    this.setFocusToFirstNode();
  }

  closeModal() {
    this.setPluginState({
      isHidden: true,
    });

    if (this.opts.disablePageScrollWhenModalOpen) {
      document.body.classList.remove('uppy-Grill-isOpen');
    }

    this.savedActiveElement.focus();
  }

  isModalOpen() {
    return !this.getPluginState().isHidden || false;
  }

  onKeydown(event) {
    // close modal on esc key press
    if (event.keyCode === 27) this.requestCloseModal(event);
    // maintainFocus on tab key press
    if (event.keyCode === 9) this.maintainFocus(event);
  }

  handleClickOutside() {
    if (this.opts.closeModalOnClickOutside) this.requestCloseModal();
  }

  handlePaste(ev) {
    const files = toArray(ev.clipboardData.items);
    files.forEach(file => {
      if (file.kind !== 'file') return;

      const blob = file.getAsFile();
      if (!blob) {
        this.uppy.log('[Grill] File pasted, but the file blob is empty');
        this.uppy.info('Error pasting file', 'error');
        return;
      }
      this.uppy.log('[Grill] File pasted');
      this.uppy.addFile({
        source: this.id,
        name: file.name,
        type: file.type,
        data: blob,
      });
    });
  }

  handleInputChange(ev) {
    ev.preventDefault();
    const files = toArray(ev.target.files);

    files.forEach(file => {
      this.uppy.addFile({
        source: this.id,
        name: file.name,
        type: file.type,
        data: file,
      });
    });
  }

  initEvents() {
    // Modal open button
    const showModalTrigger = findAllDOMElements(this.opts.trigger);
    if (!this.opts.inline && showModalTrigger) {
      showModalTrigger.forEach(trigger =>
        trigger.addEventListener('click', this.openModal)
      );
    }

    if (!this.opts.inline && !showModalTrigger) {
      this.uppy.log(
        'Grill modal trigger not found. Make sure `trigger` is set in Grill options unless you are planning to call openModal() method yourself'
      );
    }

    if (!this.opts.inline) {
      document.addEventListener('keydown', this.onKeydown);
    }

    // Drag Drop
    this.removeDragDropListener = dragDrop(this.el, files => {
      this.handleDrop(files);
    });

    this.uppy.on('Grill:file-card', this.handleFileCard);

    this.updateGrillElWidth();
    window.addEventListener('resize', this.updateGrillElWidth);
  }

  removeEvents() {
    const showModalTrigger = findAllDOMElements(this.opts.trigger);
    if (!this.opts.inline && showModalTrigger) {
      showModalTrigger.forEach(trigger =>
        trigger.removeEventListener('click', this.openModal)
      );
    }

    if (!this.opts.inline) {
      document.removeEventListener('keydown', this.onKeydown);
    }

    this.removeDragDropListener();
    this.uppy.off('Grill:file-card', this.handleFileCard);
    window.removeEventListener('resize', this.updateGrillElWidth);
  }

  updateGrillElWidth() {
    const GrillEl = this.el.querySelector('.uppy-Grill-inner');
    this.uppy.log(`Grill width: ${GrillEl.offsetWidth}`);

    this.setPluginState({
      containerWidth: GrillEl.offsetWidth,
    });
  }

  handleFileCard(fileId) {
    this.setPluginState({
      fileCardFor: fileId || false,
    });
  }

  handleDrop(files) {
    this.uppy.log('[Grill] Files were dropped');

    files.forEach(file => {
      this.uppy.addFile({
        source: this.id,
        name: file.name,
        type: file.type,
        data: file,
      });
    });
  }

  render(state) {
    const pluginState = this.getPluginState();
    const { files } = state;

    const newFiles = Object.keys(files).filter(
      file => !files[file].progress.uploadStarted
    );
    const inProgressFiles = Object.keys(files).filter(
      file =>
        !files[file].progress.uploadComplete &&
        files[file].progress.uploadStarted &&
        !files[file].isPaused
    );

    const inProgressFilesArray = [];
    inProgressFiles.forEach(file => {
      inProgressFilesArray.push(files[file]);
    });

    let totalSize = 0; // eslint-disable-line
    let totalUploadedSize = 0; // eslint-disable-line
    inProgressFilesArray.forEach(file => {
      totalSize += file.progress.bytesTotal || 0;
      totalUploadedSize += file.progress.bytesUploaded || 0;
    });
    totalSize = prettyBytes(totalSize);
    totalUploadedSize = prettyBytes(totalUploadedSize);

    const attachRenderFunctionToTarget = target => {
      const plugin = this.uppy.getPlugin(target.id);
      return Object.assign({}, target, {
        icon: plugin.icon || this.opts.defaultTabIcon,
        render: plugin.render,
      });
    };

    const isSupported = target => {
      const plugin = this.uppy.getPlugin(target.id);
      // If the plugin does not provide a `supported` check, assume the plugin works everywhere.
      if (typeof plugin.isSupported !== 'function') {
        return true;
      }
      return plugin.isSupported();
    };

    const acquirers = pluginState.targets
      .filter(target => target.type === 'acquirer' && isSupported(target))
      .map(attachRenderFunctionToTarget);

    const progressindicators = pluginState.targets
      .filter(target => target.type === 'progressindicator')
      .map(attachRenderFunctionToTarget);

    const startUpload = () => {
      this.uppy.upload().catch(err => {
        // Log error.
        this.uppy.log(err.stack || err.message || err);
      });
    };

    const cancelUpload = fileID => {
      this.uppy.emit('upload-cancel', fileID);
      this.uppy.removeFile(fileID);
    };

    const showFileCard = fileID => {
      this.uppy.emit('Grill:file-card', fileID);
    };

    const fileCardDone = (meta, fileID) => {
      this.uppy.setFileMeta(fileID, meta);
      this.uppy.emit('Grill:file-card');
    };

    return GrillUI({
      state,
      modal: pluginState,
      newFiles,
      files,
      totalFileCount: Object.keys(files).length,
      totalProgress: state.totalProgress,
      acquirers,
      activePanel: pluginState.activePanel,
      getPlugin: this.uppy.getPlugin,
      progressindicators,
      autoProceed: this.uppy.opts.autoProceed,
      hideUploadButton: this.opts.hideUploadButton,
      id: this.id,
      closeModal: this.requestCloseModal,
      handleClickOutside: this.handleClickOutside,
      handleInputChange: this.handleInputChange,
      handlePaste: this.handlePaste,
      showProgressDetails: this.opts.showProgressDetails,
      inline: this.opts.inline,
      showPanel: this.showPanel,
      hideAllPanels: this.hideAllPanels,
      log: this.uppy.log,
      i18n: this.i18n,
      addFile: this.uppy.addFile,
      removeFile: this.uppy.removeFile,
      info: this.uppy.info,
      note: this.opts.note,
      metaFields: this.getPluginState().metaFields,
      resumableUploads: this.uppy.state.capabilities.resumableUploads || false,
      startUpload,
      pauseUpload: this.uppy.pauseResume,
      retryUpload: this.uppy.retryUpload,
      cancelUpload,
      fileCardFor: pluginState.fileCardFor,
      showFileCard,
      fileCardDone,
      updateGrillElWidth: this.updateGrillElWidth,
      maxWidth: this.opts.maxWidth,
      maxHeight: this.opts.maxHeight,
      currentWidth: pluginState.containerWidth,
      isWide: pluginState.containerWidth > 400,
    });
  }

  discoverProviderPlugins() {
    this.uppy.iteratePlugins(plugin => {
      if (
        plugin &&
        !plugin.target &&
        plugin.opts &&
        plugin.opts.target === this.constructor
      ) {
        this.addTarget(plugin);
      }
    });
  }

  install() {
    // Set default state for Modal
    this.setPluginState({
      isHidden: true,
      showFileCard: false,
      activePanel: false,
      metaFields: this.opts.metaFields,
      targets: [],
    });

    const { target } = this.opts;
    if (target) {
      this.mount(target, this);
    }

    const plugins = this.opts.plugins || [];
    plugins.forEach(pluginID => {
      const plugin = this.uppy.getPlugin(pluginID);
      if (plugin) plugin.mount(this, plugin);
    });

    if (!this.opts.disableStatusBar) {
      this.uppy.use(StatusBar, {
        target: this,
        hideUploadButton: this.opts.hideUploadButton,
        hideAfterFinish: this.opts.hideProgressAfterFinish,
        locale: this.opts.locale,
      });
    }

    if (!this.opts.disableInformer) {
      this.uppy.use(Informer, {
        target: this,
      });
    }

    if (!this.opts.disableThumbnailGenerator) {
      this.uppy.use(ThumbnailGenerator, {
        thumbnailWidth: this.opts.thumbnailWidth,
      });
    }

    this.discoverProviderPlugins();

    this.initEvents();
  }

  uninstall() {
    if (!this.opts.disableInformer) {
      const informer = this.uppy.getPlugin('Informer');
      // Checking if this plugin exists, in case it was removed by uppy-core
      // before the Grill was.
      if (informer) this.uppy.removePlugin(informer);
    }

    if (!this.opts.disableStatusBar) {
      const statusBar = this.uppy.getPlugin('StatusBar');
      if (statusBar) this.uppy.removePlugin(statusBar);
    }

    if (!this.opts.disableThumbnailGenerator) {
      const thumbnail = this.uppy.getPlugin('ThumbnailGenerator');
      if (thumbnail) this.uppy.removePlugin(thumbnail);
    }

    const plugins = this.opts.plugins || [];
    plugins.forEach(pluginID => {
      const plugin = this.uppy.getPlugin(pluginID);
      if (plugin) plugin.unmount();
    });

    this.unmount();
    this.removeEvents();
  }
}

export default Grill;