package com.muse.eventbridge

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Process
import org.json.JSONObject
import java.time.Instant

fun hasUsageAccess(context: Context): Boolean {
    val appOps = context.getSystemService(AppOpsManager::class.java)
    val mode = appOps.unsafeCheckOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName
    )
    return if (mode == AppOpsManager.MODE_DEFAULT) {
        context.checkSelfPermission(Manifest.permission.PACKAGE_USAGE_STATS) == PackageManager.PERMISSION_GRANTED
    } else {
        mode == AppOpsManager.MODE_ALLOWED
    }
}

@Suppress("DEPRECATION")
fun appLabel(context: Context, packageName: String): String = try {
    val pm = context.packageManager
    pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
} catch (e: PackageManager.NameNotFoundException) {
    packageName
}

/** Builds the JSON payload. Only package name, label and timestamps: nothing else leaves the device. */
object EventFactory {
    fun fromTransition(context: Context, prefs: Prefs, t: Transition): OutgoingEvent =
        build(
            context, prefs, t.type, t.packageName, t.timeMs,
            priorityFor(t.packageName, prefs.watchlist), t.sessionSeconds
        )

    fun test(context: Context, prefs: Prefs): OutgoingEvent =
        build(
            context, prefs, EventTypes.TEST, context.packageName, System.currentTimeMillis(),
            Priority.NORMAL, null
        )

    private fun build(
        context: Context,
        prefs: Prefs,
        type: String,
        packageName: String,
        timeMs: Long,
        priority: String,
        sessionSeconds: Long?,
    ): OutgoingEvent {
        val label = appLabel(context, packageName)
        val json = JSONObject()
            .put("device_id", prefs.deviceId)
            .put("timestamp", Instant.ofEpochMilli(timeMs).toString())
            .put("event_type", type)
            .put("package_name", packageName)
            .put("app_label", label)
            .put("priority", priority)
        if (sessionSeconds != null) json.put("session_seconds", sessionSeconds)
        return OutgoingEvent(type, packageName, label, priority, timeMs, json.toString())
    }
}
