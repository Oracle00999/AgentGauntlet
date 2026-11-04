import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/web',timeout:60000,workers:1,reporter:'list',use:{baseURL:process.env.WEB_TEST_ORIGIN||'http://127.0.0.1:3000',viewport:{width:1440,height:1000},headless:true,launchOptions:{channel:'chrome'},screenshot:'only-on-failure'}});
