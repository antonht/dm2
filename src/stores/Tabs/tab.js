import {
  applySnapshot,
  clone,
  destroy,
  flow,
  getParent,
  getRoot,
  getSnapshot,
  types,
} from "mobx-state-tree";
import { guidGenerator } from "../../utils/random";
import { TabFilter } from "./tab_filter";
import { TabHiddenColumns } from "./tab_hidden_columns";
import { TabSelectedItems } from "./tab_selected_items";

export const Tab = types
  .model("View", {
    id: types.identifierNumber,

    title: "Tasks",
    oldTitle: types.maybeNull(types.string),

    key: types.optional(types.string, guidGenerator),

    type: types.optional(types.enumeration(["list", "grid"]), "list"),

    target: types.optional(
      types.enumeration(["tasks", "annotations"]),
      "tasks"
    ),

    filters: types.array(types.late(() => TabFilter)),
    conjunction: types.optional(types.enumeration(["and", "or"]), "and"),
    hiddenColumns: types.maybeNull(types.optional(TabHiddenColumns, {})),
    ordering: types.optional(types.array(types.string), []),
    selected: types.optional(TabSelectedItems, {}),
    opener: types.optional(types.maybeNull(types.late(() => Tab)), null),
    columnsWidth: types.map(types.maybeNull(types.number)),
    columnsDisplayType: types.map(types.maybeNull(types.string)),
    gridWidth: 4,

    enableFilters: false,
    renameMode: false,
    saved: false,
    virtual: false,
    locked: false,
  })
  .volatile(() => {
    const defaultWidth = window.innerWidth * 0.35;
    const labelingTableWidth = parseInt(
      localStorage.getItem("labelingTableWidth") ?? defaultWidth
    );
    return {
      labelingTableWidth,
    };
  })
  .views((self) => ({
    get root() {
      return getRoot(self);
    },

    get parent() {
      return getParent(getParent(self));
    },

    get columns() {
      return getRoot(self).viewsStore.columns;
    },

    get targetColumns() {
      return self.columns.filter((c) => c.target === self.target);
    },

    // get fields formatted as columns structure for react-table
    get fieldsAsColumns() {
      return self.columns.reduce((res, column) => {
        if (!column.parent) {
          res.push(...column.asField);
        }
        return res;
      }, []);
    },

    get hiddenColumnsList() {
      return self.columns.filter((c) => c.hidden).map((c) => c.key);
    },

    get availableFilters() {
      return self.parent.availableFilters;
    },

    get dataStore() {
      return getRoot(self).dataStore;
    },

    get taskStore() {
      return getRoot(self).taskStore;
    },

    get annotationStore() {
      return getRoot(self).annotationStore;
    },

    get currentFilters() {
      return self.filters.filter((f) => f.target === self.target);
    },

    get currentOrder() {
      return self.ordering.length
        ? self.ordering.reduce((res, field) => {
            const fieldName = field.replace(/^-/, "");
            const desc = field[0] === "-";

            return {
              ...res,
              [fieldName]: desc,
              desc,
              field: fieldName,
              column: self.columns.find((c) => c.id === fieldName),
            };
          }, {})
        : null;
    },

    get filtersApplied() {
      return self.validFilters.length > 0;
    },

    get validFilters() {
      return self.filters.filter((f) => !!f.isValidFilter);
    },

    get serializedFilters() {
      return self.validFilters.map((el) => ({
        ...getSnapshot(el),
        type: el.filter.type,
      }));
    },

    get selectedLength() {
      const selectedLength = self.selected.list.length;
      const dataLength = self.dataStore.total;

      return self.selected.all ? dataLength - selectedLength : selectedLength;
    },

    serialize() {
      return {
        id: self.id,
        title: self.title,
        ordering: self.ordering,
        type: self.type,
        target: self.target,
        filters: {
          conjunction: self.conjunction,
          items: self.serializedFilters,
        },
        hiddenColumns: getSnapshot(self.hiddenColumns),
        selectedItems: self.selected.snapshot,
        columnsWidth: self.columnsWidth.toPOJO(),
        columnsDisplayType: self.columnsDisplayType.toPOJO(),
        gridWidth: self.gridWidth,
      };
    },
  }))
  .actions((self) => ({
    lock() {
      self.locked = true;
    },

    unlock() {
      self.locked = false;
    },

    setType(type) {
      self.type = type;
      self.save();
    },

    setTarget(target) {
      self.target = target;
      self.save();
    },

    setTitle(title) {
      self.title = title;
    },

    setRenameMode(mode) {
      self.renameMode = mode;
      if (self.renameMode) self.oldTitle = self.title;
    },

    setConjunction(value) {
      self.conjunction = value;
      self.save();
    },

    setFilters(filters) {
      self.filters.push(...(filters ?? []));
    },

    setOrdering(value) {
      if (value === null) {
        self.ordering = [];
      } else {
        const direction = self.currentOrder?.[value];
        let ordering = value;

        if (direction !== undefined) {
          ordering = direction ? value : `-${value}`;
        }

        self.ordering[0] = ordering;
      }

      self.save({ interaction: "ordering" });
    },

    setLabelingTableWidth(width) {
      self.labelingTableWidth = width;
      localStorage.setItem("labelingTableWidth", self.labelingTableWidth);
    },

    setGridWidth(width) {
      self.gridWidth = width;
      self.save();
    },

    setSelected(ids) {
      self.selected = ids;
      self.updateSelectedList("setSelectedItems", Array.from(self.selected));
    },

    selectAll() {
      self.selected.toggleSelectedAll();
      self.updateSelectedList("setSelectedItems");
    },

    clearSelection() {
      self.selected.clear();
      self.updateSelectedList("setSelectedItems");
    },

    toggleSelected(id) {
      const isSelected = self.selected.list.includes(id);
      const action = isSelected ? "deleteSelectedItem" : "addSelectedItem";

      self.selected.toggleItem(id);

      self.updateSelectedList(action, {
        [self.selected.listName]: [id],
      });
    },

    setColumnWidth(columnID, width) {
      if (width) {
        self.columnsWidth.set(columnID, width);
      } else {
        self.columnsWidth.delete(columnID);
      }
    },

    setColumnDisplayType(columnID, type) {
      if (type !== null) {
        self.columnsDisplayType.set(columnID, type);
      } else {
        self.columnsDisplayType.delete(columnID);
      }
    },

    updateSelectedList: flow(function* (action, extraData) {
      const response = yield getRoot(self).apiCall(
        action,
        { tabID: self.id },
        { body: { ...self.selected.snapshot, ...(extraData ?? {}) } }
      );

      const selectedItems = response.selectedItems ?? response;
      self.selected.update(selectedItems);
    }),

    createFilter() {
      const filterType = self.availableFilters[0];
      const filter = TabFilter.create({
        filter: filterType,
        view: self.id,
      });

      self.filters.push(filter);

      if (filter.isValidFilter) self.save();
    },

    toggleColumn(column) {
      if (self.hiddenColumns.hasColumn(column)) {
        self.hiddenColumns.remove(column);
      } else {
        self.hiddenColumns.add(column);
      }
      self.save({ reload: false });
    },

    reload: flow(function* ({ interaction } = {}) {
      if (self.saved) {
        yield self.dataStore.reload({ interaction });
      }
    }),

    deleteFilter(filter) {
      const index = self.filters.findIndex((f) => f === filter);
      self.filters.splice(index, 1);
      destroy(filter);
      self.save();
    },

    afterAttach() {
      self.hiddenColumns =
        self.hiddenColumns ?? clone(self.parent.defaultHidden);
    },

    save: flow(function* ({ reload, interaction } = {}) {
      if (self.virtual) return;
      const needsLock = ["ordering", "filter"].includes(interaction);

      if (needsLock) self.lock();
      const { id: tabID } = self;
      const body = { body: self.serialize() };
      const params = { tabID };

      if (interaction !== undefined) Object.assign(params, { interaction });

      const result = yield getRoot(self).apiCall("updateTab", params, body);
      const viewSnapshot = getSnapshot(self);

      applySnapshot(self, {
        ...viewSnapshot,
        ...result,
        filters: viewSnapshot.filters,
        conjunction: viewSnapshot.conjunction,
      });

      self.saved = true;
      if (reload !== false) self.reload({ interaction });

      self.unlock();
    }),

    delete: flow(function* () {
      yield getRoot(self).apiCall("deleteTab", { tabID: self.id });
    }),
  }))
  .preProcessSnapshot((snapshot) => {
    if (snapshot === null) return snapshot;

    const { filters, selectedItems, ...sn } = snapshot ?? {};

    if (filters && !Array.isArray(filters)) {
      const { conjunction, items } = filters ?? {};

      Object.assign(sn, {
        filters: items ?? [],
        conjunction: conjunction ?? "and",
      });
    } else {
      sn.filters = filters;
    }

    if (selectedItems) {
      Object.assign(sn, { selected: selectedItems });
    }

    return sn;
  });
