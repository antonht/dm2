/** @typedef {import("../stores/Tasks").TaskModel} Task */
/** @typedef {import("label-studio").LabelStudio} LabelStudio */
/** @typedef {import("./dm-sdk").DataManager} DataManager */

/** @typedef {{
 * user: Dict
 * config: string,
 * interfaces: string[],
 * task: Task
 * labelStream: boolean,
 * }} LSFOptions */

import { LSFHistory } from "./lsf-history";
import { completionToServer, taskToLSFormat } from "./lsf-utils";

const DEFAULT_INTERFACES = [
  "basic",
  "skip",
  "predictions",
  "predictions:menu", // right menu with prediction items
  "completions:menu", // right menu with completion items
  "completions:add-new",
  "completions:delete",
  "side-column", // entity
];

let LabelStudioDM;

const resolveLabelStudio = async () => {
  if (LabelStudioDM) {
    return LabelStudioDM;
  } else if (window.LabelStudio) {
    return (LabelStudioDM = window.LabelStudio);
  }
};

export class LSFWrapper {
  /** @type {HTMLElement} */
  root = null;

  /** @type {DataManager} */
  datamanager = null;

  /** @type {Task} */
  task = null;

  /** @type {Completion} */
  initialCompletion = null;

  /** @type {LabelStudio} */
  lsf = null;

  /** @type {LSFHistory} */
  history = null;

  /** @type {boolean} */
  labelStream = false;

  /**
   *
   * @param {DataManager} dm
   * @param {HTMLElement} element
   * @param {LSFOptions} options
   */
  constructor(dm, element, options) {
    this.datamanager = dm;
    this.root = element;
    this.task = options.task;
    this.labelStream = options.labelStream ?? false;
    this.initialCompletion = options.completion;
    this.history = this.datamanager.isLabelStream ? new LSFHistory(this) : null;

    const lsfProperties = {
      user: options.user,
      config: this.lsfConfig,
      task: taskToLSFormat(this.task),
      description: this.instructions,
      interfaces: DEFAULT_INTERFACES,
      /* EVENTS */
      onLabelStudioLoad: this.onLabelStudioLoad,
      onTaskLoad: this.onTaskLoad,
      onSubmitCompletion: this.onSubmitCompletion,
      onUpdateCompletion: this.onUpdateCompletion,
      onDeleteCompletion: this.onDeleteCompletion,
      onSkipTask: this.onSkipTask,
      onGroundTruth: this.onGroundTruth,
      onEntityCreate: this.onEntityCreate,
      onEntityDelete: this.onEntityDelete,
      onSelectCompletion: this.onSelectCompletion,
    };

    this.initLabelStudio(lsfProperties);
  }

  /** @private */
  async initLabelStudio(settings) {
    try {
      const LSF = await resolveLabelStudio();
      this.globalLSF = window.LabelStudio === LSF;
      new LSF(this.root, settings);
    } catch (err) {
      console.error("Failed to initialize LabelStudio", settings);
      console.error(err);
    }
  }

  /** @private */
  async loadTask(taskID, completionID) {
    if (!this.lsf) {
      return console.error("Make sure that LSF was properly initialized");
    }

    const tasks = this.datamanager.store.taskStore;
    const newTask = await this.withinLoadingState(async () => {
      return tasks.loadTask(taskID);
    });
    const needsCompletionsMerge = newTask && this.task?.id === newTask.id;
    const completions = needsCompletionsMerge ? [...this.completions] : [];

    this.task = newTask;

    /* If we're in label stream and there's no task – end the stream */
    if (taskID === undefined && !newTask) {
      this.lsf.setFlags({ noTask: true });
      return;
    }

    if (completions.length) {
      this.task.mergeCompletions(completions);
    }

    /**
     * Add new data from received task
     */
    if (newTask) {
      this.setLoading(false);
      this.setTask(newTask);
      this.setCompletion(completionID);
    }
  }

  /** @private */
  setTask(task) {
    this.lsf.resetState();
    this.lsf.assignTask(task);
    this.lsf.initializeStore(taskToLSFormat(task));
  }

  /** @private */
  setCompletion(completionID) {
    const id = completionID ? completionID.toString() : null;
    let { completionStore: cs } = this.lsf;
    let completion;

    if (this.predictions.length > 0 && this.labelStream) {
      completion = cs.addCompletionFromPrediction(this.predictions[0]);
    } else if (this.completions.length > 0 && id === "auto") {
      completion = { id: this.completions[0].id };
    } else if (this.completions.length > 0 && id) {
      completion = this.completions.find((c) => c.pk === id || c.id === id);
    } else {
      completion = cs.addCompletion({ userGenerate: true });
    }

    if (completion) {
      cs.selectCompletion(completion.id);
      this.datamanager.invoke("completionSet", [completion]);
    }
  }

  onLabelStudioLoad = async (ls) => {
    this.datamanager.invoke("labelStudioLoad", [ls]);

    this.lsf = ls;

    if (this.datamanager.mode === "labelstream") {
      await this.loadTask();
    } else if (this.task) {
      const completionID =
        this.initialCompletion?.pk ?? this.task.lastCompletion?.pk ?? "auto";

      await this.loadTask(this.task.id, completionID);
    }
  };

  /** @private */
  onSubmitCompletion = async (ls, completion) => {
    await this.submitCurrentCompletion("submitCompletion", (taskID, body) =>
      this.datamanager.apiCall("submitCompletion", { taskID }, { body })
    );
  };

  /** @private */
  onUpdateCompletion = async (ls, completion) => {
    const { task } = this;
    const serializedCompletion = this.prepareData(completion);

    const result = await this.withinLoadingState(async () => {
      return this.datamanager.apiCall(
        "updateCompletion",
        {
          taskID: task.id,
          completionID: completion.pk,
        },
        {
          body: serializedCompletion,
        }
      );
    });

    this.datamanager.invoke("updateCompletion", [ls, completion, result]);

    await this.loadTask(this.task.id, completion.pk);
  };

  /**@private */
  onDeleteCompletion = async (ls, completion) => {
    const { task } = this;
    let response;

    if (completion.userGenerate && completion.sentUserGenerate === false) {
      response = { ok: true };
    } else {
      response = await this.withinLoadingState(async () => {
        return this.datamanager.apiCall("deleteCompletion", {
          taskID: task.id,
          completionID: completion.pk,
        });
      });

      this.task.deleteCompletion(completion);
      this.datamanager.invoke("deleteCompletion", [ls, completion]);
    }

    if (response.ok) {
      const lastCompletion =
        this.completions[this.completions.length - 1] ?? {};
      const completionID = lastCompletion.pk ?? undefined;

      await this.loadTask(task.id, completionID);
    }
  };

  onSkipTask = async () => {
    await this.submitCurrentCompletion(
      "skipTask",
      (taskID, body) => {
        const { id, ...completion } = body;
        const params = { taskID, was_cancelled: 1 };
        const options = { body: completion };

        if (id !== undefined) params.completionID = id;

        return this.datamanager.apiCall("skipTask", params, options);
      },
      true
    );
  };

  // Proxy events that are unused by DM integration
  onEntityCreate = (...args) => this.datamanager.invoke("onEntityCreate", args);
  onEntityDelete = (...args) => this.datamanager.invoke("onEntityDelete", args);
  onSelectCompletion = (...args) =>
    this.datamanager.invoke("onSelectCompletion", args);

  async submitCurrentCompletion(eventName, submit, includeID = false) {
    const { taskID, currentCompletion } = this;
    const serializedCompletion = this.prepareData(currentCompletion, includeID);

    this.setLoading(true);
    const result = await this.withinLoadingState(async () => {
      return submit(taskID, serializedCompletion);
    });

    if (result && result.id !== undefined) {
      currentCompletion.updatePersonalKey(result.id.toString());

      const eventData = completionToServer(currentCompletion);
      this.datamanager.invoke(eventName, [this.lsf, eventData, result]);

      this.history?.add(taskID, currentCompletion.pk);
    }
    this.setLoading(false);

    if (this.datamanager.isExplorer) {
      await this.loadTask(taskID, currentCompletion.pk);
    } else {
      await this.loadTask();
    }
  }

  /** @private */
  prepareData(completion, includeId) {
    const userGenerate =
      !completion.userGenerate || completion.sentUserGenerate;

    const result = {
      lead_time: (new Date() - completion.loadedDate) / 1000, // task execution time
      result: completion.serializeCompletion(),
    };

    if (includeId && userGenerate) {
      result.id = parseInt(completion.pk);
    }

    return result;
  }

  /** @private */
  setLoading(isLoading) {
    this.lsf.setFlags({ isLoading });
  }

  async withinLoadingState(callback) {
    let result;

    this.setLoading(true);
    if (callback) {
      result = await callback.call(this);
    }
    this.setLoading(false);

    return result;
  }

  get taskID() {
    return this.task.id;
  }

  get currentCompletion() {
    try {
      return this.lsf.completionStore.selected;
    } catch {
      console.trace("Something went wrong when accessing current completion");
      return null;
    }
  }

  get completions() {
    return this.lsf.completionStore.completions;
  }

  get predictions() {
    return this.lsf.completionStore.predictions;
  }

  /** @returns {string|null} */
  get lsfConfig() {
    return this.project.label_config_line ?? this.project.label_config;
  }

  /** @returns {Dict} */
  get project() {
    return this.datamanager.store.project;
  }

  /** @returns {string|null} */
  get instructions() {
    return (this.project.instruction ?? "").trim() || null;
  }
}
