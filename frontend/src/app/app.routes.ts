import { Routes } from '@angular/router';
import { adminGuard } from './core/auth/admin.guard';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./features/capture/capture').then((m) => m.Capture) },
      { path: 'result', loadComponent: () => import('./features/result/result').then((m) => m.Result) },
      { path: 'result/:id', loadComponent: () => import('./features/result/result').then((m) => m.Result) },
      { path: 'history', loadComponent: () => import('./features/history/history').then((m) => m.History) },
      { path: 'profile', loadComponent: () => import('./features/profile/profile').then((m) => m.Profile) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings').then((m) => m.Settings) },
      {
        path: 'admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/admin').then((m) => m.Admin),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
