// 认证相关接口：登录（多方式扩展）、用户信息、动态菜单、刷新 token、登出
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { auth, signTokens, revokeTokens, SECRET } = require("../middleware/auth");

const router = express.Router();

/** 考勤系统动态菜单（供 pure-admin 前端 getAsyncRoutes 消费，兼容其格式） */
const ROUTES = {
  admin: [
    {
      // 待办：校区负责人与老师共用的同一张表，页面同一份（按角色过滤）
      path: "/todos",
      component: "system/todos/index",
      name: "SysTodos",
      meta: { title: "待办", icon: "ep:list", rank: 0 }
    },
    {
      path: "/user",
      component: "attendance/users/index",
      name: "UserManage",
      meta: { title: "员工账号", icon: "ep:user", rank: 1, roles: ["admin"] }
    },
    {
      path: "/attendance",
      meta: { title: "考勤管理", icon: "ep:data-line", rank: 2 },
      children: [
        {
          path: "/attendance/checkin",
          component: "attendance/checkin/index",
          name: "Checkin",
          meta: { title: "考勤登记" }
        },
        {
          path: "/attendance/records",
          component: "attendance/records/index",
          name: "Records",
          meta: { title: "考勤记录" }
        },
        {
          path: "/attendance/leaves",
          component: "attendance/leaves/index",
          name: "Leaves",
          meta: { title: "请假管理" }
        },
        {
          path: "/attendance/statistics",
          component: "attendance/statistics/index",
          name: "Statistics",
          meta: { title: "统计报表" }
        }
      ]
    },
    {
      path: "/recruit",
      meta: { title: "招生管理", icon: "ep:aim", rank: 3 },
      children: [
        {
          path: "/recruit/leads",
          component: "recruit/leads/index",
          name: "RecruitLeads",
          meta: { title: "线索管理" }
        }
      ]
    },
    {
      path: "/family",
      meta: { title: "家校管理", icon: "ep:connection", rank: 4 },
      children: [
        {
          path: "/family/notifications",
          component: "family/notifications/index",
          name: "FamilyNotifications",
          meta: { title: "通知记录" }
        }
      ]
    },
    {
      path: "/teaching",
      meta: { title: "教学结果", icon: "ep:notebook", rank: 5 },
      children: [
        {
          path: "/teaching/exams",
          component: "teaching/exams/index",
          name: "TeachingExams",
          meta: { title: "成绩管理" }
        },
        {
          path: "/teaching/reports",
          component: "teaching/reports/index",
          name: "TeachingReports",
          meta: { title: "学习报告" }
        },
        {
          path: "/teaching/growth",
          component: "teaching/growth/index",
          name: "TeachingGrowth",
          meta: { title: "成长档案" }
        }
      ]
    },
    {
      path: "/finance",
      meta: { title: "财务管理", icon: "ep:wallet", rank: 6 },
      children: [
        {
          path: "/finance/orders",
          component: "finance/orders/index",
          name: "FinanceOrders",
          meta: { title: "报班管理" }
        },
        {
          path: "/finance/payments",
          component: "finance/payments/index",
          name: "FinancePayments",
          meta: { title: "缴费记录" }
        },
        {
          path: "/finance/refunds",
          component: "finance/refunds/index",
          name: "FinanceRefunds",
          meta: { title: "退费管理" }
        },
        {
          path: "/finance/statistics",
          component: "finance/statistics/index",
          name: "FinanceStatistics",
          meta: { title: "财务统计" }
        },
        {
          path: "/finance/business",
          component: "finance/business/index",
          name: "FinanceBusiness",
          meta: { title: "经营报表", roles: ["admin"] }
        },
        {
          path: "/finance/consumption",
          component: "finance/consumption/index",
          name: "FinanceConsumption",
          meta: { title: "课消统计" }
        }
      ]
    },
    {
      path: "/data",
      meta: { title: "数据管理", icon: "ep:files", rank: 7 },
      children: [
        {
          path: "/data/classes",
          component: "attendance/classes/index",
          name: "Classes",
          meta: { title: "班级管理" }
        },
        {
          path: "/data/students",
          component: "attendance/students/index",
          name: "Students",
          meta: { title: "学生管理" }
        },
        {
          path: "/data/courses",
          component: "attendance/courses/index",
          name: "Courses",
          meta: { title: "课程管理", roles: ["admin"] }
        },
        {
          path: "/data/schedules",
          component: "attendance/schedules/index",
          name: "Schedules",
          meta: { title: "课程表" }
        },
        {
          path: "/data/terms",
          component: "attendance/terms/index",
          name: "Terms",
          meta: { title: "学期管理", roles: ["admin"] }
        },
        {
          path: "/data/adjustments",
          component: "attendance/adjustments/index",
          name: "Adjustments",
          meta: { title: "调课审批", roles: ["admin"] }
        },
        {
          path: "/data/makeups",
          component: "attendance/makeups/index",
          name: "Makeups",
          meta: { title: "补课管理" }
        }
      ]
    },
    {
      path: "/system",
      meta: {
        title: "系统管理",
        icon: "ep:setting",
        rank: 8,
        roles: ["admin"]
      },
      children: [
        {
          path: "/system/settings",
          component: "system/settings/index",
          name: "SysSettings",
          meta: { title: "系统参数" }
        },
        {
          path: "/system/notices",
          component: "system/notices/index",
          name: "SysNotices",
          meta: { title: "通知公告" }
        },
        {
          path: "/system/backups",
          component: "system/backups/index",
          name: "SysBackups",
          meta: { title: "数据备份" }
        },
        {
          path: "/system/audit-logs",
          component: "system/audit-logs/index",
          name: "SysAuditLogs",
          meta: { title: "审计日志" }
        }
      ]
    }
  ],
  teacher: [
    {
      // 待办：老师日常第一入口（系统生成的 + 负责人指派的 + 自己建的）
      path: "/todos",
      component: "system/todos/index",
      name: "SysTodos",
      meta: { title: "待办", icon: "ep:list", rank: 0 }
    },
    {
      path: "/attendance",
      meta: { title: "考勤管理", icon: "ep:data-line", rank: 2 },
      children: [
        {
          path: "/attendance/checkin",
          component: "attendance/checkin/index",
          name: "Checkin",
          meta: { title: "考勤登记" }
        },
        {
          path: "/attendance/records",
          component: "attendance/records/index",
          name: "Records",
          meta: { title: "考勤记录" }
        },
        {
          path: "/attendance/leaves",
          component: "attendance/leaves/index",
          name: "Leaves",
          meta: { title: "请假管理" }
        },
        {
          path: "/attendance/statistics",
          component: "attendance/statistics/index",
          name: "Statistics",
          meta: { title: "统计报表" }
        }
      ]
    },
    {
      path: "/family",
      meta: { title: "家校管理", icon: "ep:connection", rank: 4 },
      children: [
        {
          path: "/family/notifications",
          component: "family/notifications/index",
          name: "FamilyNotifications",
          meta: { title: "通知记录" }
        }
      ]
    },
    {
      path: "/teaching",
      meta: { title: "教学结果", icon: "ep:notebook", rank: 5 },
      children: [
        {
          path: "/teaching/exams",
          component: "teaching/exams/index",
          name: "TeachingExams",
          meta: { title: "成绩管理" }
        },
        {
          path: "/teaching/reports",
          component: "teaching/reports/index",
          name: "TeachingReports",
          meta: { title: "学习报告" }
        },
        {
          path: "/teaching/growth",
          component: "teaching/growth/index",
          name: "TeachingGrowth",
          meta: { title: "成长档案" }
        }
      ]
    },
    {
      path: "/data",
      meta: { title: "数据管理", icon: "ep:files", rank: 7 },
      children: [
        {
          path: "/data/classes",
          component: "attendance/classes/index",
          name: "Classes",
          meta: { title: "班级管理" }
        },
        {
          path: "/data/students",
          component: "attendance/students/index",
          name: "Students",
          meta: { title: "学生管理" }
        },
        {
          path: "/data/schedules",
          component: "attendance/schedules/index",
          name: "Schedules",
          meta: { title: "课程表" }
        },
        {
          path: "/data/makeups",
          component: "attendance/makeups/index",
          name: "Makeups",
          meta: { title: "补课管理" }
        }
      ]
    }
  ]
};

function rolePermissions(role) {
  if (role === "admin") return ["*:*:*"];
  if (role === "teacher") {
    return [
      "attendance:read",
      "attendance:write",
      "leave:read",
      "leave:approve",
      "class:write",
      "student:write"
    ];
  }
  return [];
}

function buildLoginData(user) {
  const tokens = signTokens(user);
  return {
    ...tokens,
    avatar: "",
    username: user.username,
    nickname: user.name,
    roles: [user.role],
    permissions: rolePermissions(user.role)
  };
}

/**
 * 统一登录入口（预留多种登录方式）
 * body: { type: 'password' | 'phone' | 'wechat', ... }
 * 本期仅实现 password；phone / wechat 返回占位提示，供后期对接手机登录与微信小程序
 */
router.post("/login", (req, res) => {
  const { type = "password", username, password } = req.body || {};

  if (type === "phone" || type === "wechat") {
    return res.status(501).json({
      success: false,
      message: `「${type === "phone" ? "手机号" : "微信"}」登录方式尚未开放，请使用账号密码登录`
    });
  }
  if (type !== "password") {
    return res
      .status(400)
      .json({ success: false, message: "不支持的登录方式" });
  }
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "请输入账号和密码" });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(400).json({ success: false, message: "账号或密码错误" });
  }
  // 系统为纯员工端 CRM：仅员工（admin/teacher）可登录；学生/家长无账号（v14）
  if (user.role !== "admin" && user.role !== "teacher") {
    return res
      .status(403)
      .json({ success: false, message: "该账号无登录权限" });
  }
  res.json({ success: true, data: buildLoginData(user) });
});

/** 占位：发送短信验证码（手机号登录） */
router.post("/sms-code", (_req, res) => {
  res.status(501).json({ success: false, message: "短信验证码功能尚未开放" });
});

/** 占位：微信小程序登录（wx.login code 换 token） */
router.post("/wechat", (_req, res) => {
  res.status(501).json({ success: false, message: "微信小程序登录尚未开放" });
});

/** 获取当前登录用户信息（PC 与小程序多端共用） */
router.get("/info", auth, (req, res) => {
  const user = db
    .prepare(
      "SELECT id, username, name, role, phone, created_at FROM users WHERE id = ?"
    )
    .get(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, message: "用户不存在" });
  }
  res.json({
    success: true,
    data: {
      username: user.username,
      name: user.name,
      nickname: user.name,
      avatar: "",
      phone: user.phone || "",
      roles: [user.role],
      permissions: rolePermissions(user.role)
    }
  });
});

/** 动态路由菜单（按角色下发，配合前端 initRouter 使用） */
router.get("/async-routes", auth, (req, res) => {
  const routes = ROUTES[req.user.role] || [];
  res.json({ success: true, data: routes });
});

/** 刷新 token（同时校验 tv：已被吊销的 refreshToken 不可换取新凭证） */
router.post("/refresh-token", (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res
      .status(400)
      .json({ success: false, message: "缺少 refreshToken" });
  }
  try {
    const payload = jwt.verify(refreshToken, SECRET);
    if (payload.type !== "refresh") {
      return res
        .status(400)
        .json({ success: false, message: "无效的 refreshToken" });
    }
    const user = db
      .prepare(
        "SELECT id, username, name, role, token_version FROM users WHERE id = ?"
      )
      .get(payload.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "用户不存在" });
    }
    // 吊销校验：登出 / 改密 / 改角色 / 删号后，旧 refreshToken 一律失效
    if (Number(user.token_version ?? 0) !== Number(payload.tv ?? 0)) {
      return res
        .status(401)
        .json({ success: false, message: "登录状态已失效，请重新登录" });
    }
    res.json({ success: true, data: signTokens(user) });
  } catch {
    return res
      .status(401)
      .json({ success: false, message: "refreshToken 已过期，请重新登录" });
  }
});

/** 登出：递增 token_version，服务端立即吊销该用户全部已签发凭证 */
router.post("/logout", auth, (req, res) => {
  revokeTokens(req.user.id);
  res.json({ success: true, data: null });
});

module.exports = router;
