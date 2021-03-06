import { Button, Modal, Tooltip } from "antd";
import { observer } from "mobx-react";
import React from "react";
import { BsCode } from "react-icons/bs";
import AutoSizer from "react-virtualized-auto-sizer";
import { VariableSizeList } from "react-window";
import InfiniteLoader from "react-window-infinite-loader";
import { isDefined } from "../../../utils/utils";
import { TableWrapper } from "./Table.styled";
import { TableCheckboxCell } from "./TableCheckbox";
import { TableContext } from "./TableContext";
import { TableHead } from "./TableHead";
import { TableRow } from "./TableRow";
import { prepareColumns } from "./utils";

const Decorator = (decoration) => {
  return {
    get(col) {
      return decoration.find((d) => {
        let found = false;
        if (isDefined(d.alias)) {
          found = d.alias === col.alias;
        } else if (d.resolver instanceof Function) {
          found = d.resolver(col);
        }

        return found;
      });
    },
  };
};

export const Table = observer(
  ({
    view,
    data,
    cellViews,
    selectedItems,
    focusedItem,
    decoration,
    stopInteractions,
    onColumnResize,
    onColumnReset,
    ...props
  }) => {
    const tableHead = React.useRef();
    const listRef = React.useRef();
    const columns = prepareColumns(props.columns, props.hiddenColumns);
    const Decoration = React.useMemo(() => Decorator(decoration), [decoration]);

    if (props.onSelectAll && props.onSelectRow) {
      columns.unshift({
        id: "select",
        headerClassName: "th select-all",
        cellClassName: "td select-row",
        width: 40,
        maxWidth: 40,
        justifyContent: "center",
        onClick: (e) => e.stopPropagation(),
        Header: () => {
          return (
            <div style={{ width: 30 }}>
              <TableCheckboxCell
                checked={selectedItems.isAllSelected}
                indeterminate={selectedItems.isIndeterminate}
                onChange={() => props.onSelectAll()}
                className="th select-all"
              />
            </div>
          );
        },
        Cell: ({ data }) => {
          return (
            <div style={{ width: 30 }}>
              <TableCheckboxCell
                checked={selectedItems.isSelected(data.id)}
                onChange={() => props.onSelectRow(data.id)}
                className="td"
              />
            </div>
          );
        },
      });
    }

    columns.push({
      id: "show-source",
      cellClassName: "td show-source",
      width: 40,
      maxWidth: 40,
      justifyContent: "center",
      onClick: (e) => e.stopPropagation(),
      Header() {
        return <div style={{ width: 40 }} />;
      },
      Cell({ data }) {
        let out = JSON.parse(data.source ?? "{}");
        out = {
          id: out?.id,
          data: out?.data,
          completions: out?.completions,
          predictions: out?.predictions,
        };

        return (
          <div style={{ width: 40 }}>
            <Tooltip title="Show task source">
              <Button
                type="link"
                className="flex-button"
                onClick={() => {
                  Modal.info({
                    title: "Source for task " + out?.id,
                    width: 800,
                    content: <pre>{JSON.stringify(out, null, "  ")}</pre>,
                  });
                }}
              >
                <BsCode />
              </Button>
            </Tooltip>
          </div>
        );
      },
    });

    const contextValue = {
      columns,
      data,
      cellViews,
    };

    const headerHeight = 42;

    const renderTableHeader = React.useCallback(
      ({ style }) => (
        <TableHead
          ref={tableHead}
          style={style}
          order={props.order}
          columnHeaderExtra={props.columnHeaderExtra}
          sortingEnabled={props.sortingEnabled}
          onSetOrder={props.onSetOrder}
          stopInteractions={stopInteractions}
          onTypeChange={props.onTypeChange}
          decoration={Decoration}
          onResize={onColumnResize}
          onReset={onColumnReset}
        />
      ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        props.order,
        props.columnHeaderExtra,
        props.sortingEnabled,
        props.onSetOrder,
        props.onTypeChange,
        stopInteractions,
        view,
        view.selected.list,
        view.selected.all,
        tableHead,
      ]
    );

    const renderRow = React.useCallback(
      ({ style, index }) => {
        const row = data[index - 1];

        return (
          <div className="row-wrapper" style={style}>
            <TableRow
              key={row.id}
              data={row}
              even={index % 2 === 0}
              isSelected={row.isSelected}
              isHighlighted={row.isHighlighted}
              onClick={props.onRowClick}
              stopInteractions={stopInteractions}
              style={{
                height: props.rowHeight,
                width: props.fitContent ? "fit-content" : "auto",
              }}
              decoration={Decoration}
            />
          </div>
        );
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [
        data,
        props.fitContent,
        props.onRowClick,
        props.rowHeight,
        stopInteractions,
        selectedItems,
        view,
        view.selected.list,
        view.selected.all,
      ]
    );

    const isItemLoaded = React.useCallback(
      (index) => {
        return props.isItemLoaded(data, index);
      },
      [props, data]
    );

    const initialScrollOffset = (height) => {
      const { rowHeight: h } = props;
      const index = data.indexOf(focusedItem);

      if (index >= 0) {
        const scrollOffset = index * h - height / 2 + h / 2; // + headerHeight
        return scrollOffset;
      } else {
        return 0;
      }
    };

    const itemKey = React.useCallback(
      (index) => {
        return data[index]?.key ?? index;
      },
      [data]
    );

    React.useEffect(() => {
      const listComponent = listRef.current?._listRef;
      if (listComponent) {
        listComponent.scrollToItem(data.indexOf(focusedItem), "center");
      }
    }, [data, focusedItem]);

    // React.useEffect(() => {
    //   console.log(tableHead.current);
    // }, [tableHead.current]);

    return (
      <TableWrapper fitToContent={props.fitToContent}>
        <TableContext.Provider value={contextValue}>
          <StickyList
            ref={listRef}
            overscanCount={10}
            className="virtual-table"
            itemHeight={props.rowHeight}
            totalCount={props.total}
            itemCount={data.length + 1}
            itemKey={itemKey}
            innerElementType={innerElementType}
            stickyItems={[0]}
            stickyItemsHeight={[headerHeight]}
            stickyComponent={renderTableHeader}
            initialScrollOffset={initialScrollOffset}
            isItemLoaded={isItemLoaded}
            loadMore={props.loadMore}
            style={{ minWidth: "fit-content" }}
          >
            {renderRow}
          </StickyList>
        </TableContext.Provider>
      </TableWrapper>
    );
  }
);

const StickyListContext = React.createContext();
StickyListContext.Provider.displayName = "StickyListProvider";
StickyListContext.Consumer.displayName = "StickyListConsumer";

const ItemWrapper = ({ data, index, style }) => {
  const { Renderer, stickyItems } = data;

  if (stickyItems?.includes(index) === true) {
    return null;
  }

  return <Renderer index={index} style={style} />;
};

const StickyList = observer(
  React.forwardRef((props, listRef) => {
    const {
      children,
      stickyComponent,
      stickyItems,
      stickyItemsHeight,
      totalCount,
      isItemLoaded,
      loadMore,
      initialScrollOffset,
      ...rest
    } = props;

    const itemData = {
      Renderer: children,
      StickyComponent: stickyComponent,
      stickyItems,
      stickyItemsHeight,
    };

    const itemSize = (index) => {
      if (stickyItems.includes(index)) {
        return stickyItemsHeight[index] ?? rest.itemHeight;
      }
      return rest.itemHeight;
    };

    return (
      <StickyListContext.Provider value={itemData}>
        <AutoSizer className="table-auto-size">
          {({ width, height }) => (
            <InfiniteLoader
              ref={listRef}
              itemCount={totalCount}
              loadMoreItems={loadMore}
              isItemLoaded={isItemLoaded}
            >
              {({ onItemsRendered, ref }) => (
                <VariableSizeList
                  {...rest}
                  ref={ref}
                  width={width}
                  height={height}
                  itemData={itemData}
                  itemSize={itemSize}
                  onItemsRendered={onItemsRendered}
                  initialScrollOffset={initialScrollOffset?.(height) ?? 0}
                >
                  {ItemWrapper}
                </VariableSizeList>
              )}
            </InfiniteLoader>
          )}
        </AutoSizer>
      </StickyListContext.Provider>
    );
  })
);

StickyList.displayName = "StickyList";

const innerElementType = React.forwardRef(({ children, ...rest }, ref) => {
  return (
    <StickyListContext.Consumer>
      {({ stickyItems, stickyItemsHeight, StickyComponent }) => (
        <div ref={ref} {...rest}>
          {stickyItems.map((index) => (
            <StickyComponent
              key={index}
              index={index}
              style={{
                width: "100%",
                height: stickyItemsHeight[index],
                top: index * stickyItemsHeight[index],
              }}
            />
          ))}

          {children}
        </div>
      )}
    </StickyListContext.Consumer>
  );
});
