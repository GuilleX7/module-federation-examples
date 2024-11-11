import Vue from 'vue';
import App from './App.vue';
import Box from './Box.vue';

async function mount({ parentContainer }: { parentContainer: HTMLElement }) {
  const container = document.createElement('div');
  parentContainer.appendChild(container);

  Vue.component('Box', Box);

  new Vue({
    render: h => h(App),
  }).$mount(container);
}

export { mount };
