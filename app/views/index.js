import { render } from './list.js';
export const views = [{ id:'list', name:'列表', render }];
export const getView = id => views.find(view => view.id === id) || views[0];
