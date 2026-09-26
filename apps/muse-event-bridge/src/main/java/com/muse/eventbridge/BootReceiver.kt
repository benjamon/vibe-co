package com.muse.eventbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Restarts monitoring after reboot or app update, if it was on before. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!Prefs(context).monitoringEnabled || !hasUsageAccess(context)) return
        try {
            // Both broadcasts are exempt from background FGS start limits (Android 12+),
            // and specialUse may be started from BOOT_COMPLETED on Android 14/15.
            MonitorService.start(context)
        } catch (e: Exception) {
            Log.e("BootReceiver", "could not start monitoring", e)
        }
    }
}
