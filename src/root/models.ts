export type SinglePageNode = {
  type: 'single';
  name: string;
  path: string;

  component?: import('react').FC<any>;
};

export type MultiplePageNode = {
  type: 'collection';
  name: string;
  items: SinglePageNode[];
  path: undefined;
};

export type RootItemModel = SinglePageNode | MultiplePageNode;

export type RootModel = {
  routes: RootItemModel[];
};
