// 考勤系统业务接口（班级/学生/课程/考勤/请假/看板）
import { http } from "@/utils/http";

/** ---------- 班级 ---------- */

/** 班级列表（分页 + 名称搜索） */
export const getClassList = (params?: object) => {
  return http.request("get", "/api/classes", { params });
};

/** 班级下拉（全部） */
export const getAllClasses = () => {
  return http.request("get", "/api/classes/all");
};

/** 新增班级 */
export const createClass = (data: object) => {
  return http.request("post", "/api/classes", { data });
};

/** 修改班级 */
export const updateClass = (id: number, data: object) => {
  return http.request("put", `/api/classes/${id}`, { data });
};

/** 删除班级 */
export const deleteClass = (id: number) => {
  return http.request("delete", `/api/classes/${id}`);
};

/** ---------- 学生 ---------- */

/** 学生列表（分页 + 班级/姓名/学号过滤） */
export const getStudentList = (params?: object) => {
  return http.request("get", "/api/students", { params });
};

/** 新增学生 */
export const createStudent = (data: object) => {
  return http.request("post", "/api/students", { data });
};

/** 修改学生 */
export const updateStudent = (id: number, data: object) => {
  return http.request("put", `/api/students/${id}`, { data });
};

/** 删除学生 */
export const deleteStudent = (id: number) => {
  return http.request("delete", `/api/students/${id}`);
};

/** ---------- 课程 ---------- */

/** 课程列表（分页 + 关键字搜索） */
export const getCourseList = (params?: object) => {
  return http.request("get", "/api/courses", { params });
};

/** 课程下拉（全部） */
export const getAllCourses = () => {
  return http.request("get", "/api/courses/all");
};

/** 新增课程 */
export const createCourse = (data: object) => {
  return http.request("post", "/api/courses", { data });
};

/** 修改课程 */
export const updateCourse = (id: number, data: object) => {
  return http.request("put", `/api/courses/${id}`, { data });
};

/** 删除课程 */
export const deleteCourse = (id: number) => {
  return http.request("delete", `/api/courses/${id}`);
};

/** ---------- 考勤 ---------- */

/**
 * 某课程某日全班考勤名单。
 * @param params { date, class_id, course_id } 旧行为（按日期+班级+课程）
 *   传 session_id 时改按课次取名单（date/course_id/班级取自课次），含停课校验与代课人可见
 */
export const getAttendanceList = (params?: object) => {
  return http.request("get", "/api/attendance", { params });
};

/**
 * 批量保存考勤。
 * @param data { course_id, date, records[] } 旧行为（不传 session_id 时保持原样）
 *   body 增可选 session_id：有则按课次 upsert + 停课阻断 + 代课人可录；
 *   course_id/date 由后端取自课次，前端仍可传以便复用同一表格提交逻辑
 */
export const saveAttendanceBatch = (data: object) => {
  return http.request("post", "/api/attendance/batch", { data });
};

/** 考勤统计 */
export const getAttendanceStatistics = (params?: object) => {
  return http.request("get", "/api/attendance/statistics", { params });
};

/** ---------- 请假 ---------- */

/** 请假列表（分页 + 学生/状态过滤） */
export const getLeaveList = (params?: object) => {
  return http.request("get", "/api/leaves", { params });
};

/** 新建请假申请 */
export const createLeave = (data: object) => {
  return http.request("post", "/api/leaves", { data });
};

/** 审批请假 */
export const approveLeave = (id: number, data: object) => {
  return http.request("put", `/api/leaves/${id}/approve`, { data });
};

/** ---------- 首页看板 ---------- */

/** 首页概览统计 */
export const getDashboardOverview = () => {
  return http.request("get", "/api/dashboard/overview");
};

/** ---------- 用户管理（仅 admin） ---------- */

/** 用户列表（分页 + 角色/关键字筛选） */
export const getUserList = (params?: object) => {
  return http.request("get", "/api/users", { params });
};

/** 创建用户（分配角色） */
export const createUser = (data: object) => {
  return http.request("post", "/api/users", { data });
};

/** 修改用户（姓名/角色/手机号） */
export const updateUser = (id: number, data: object) => {
  return http.request("put", `/api/users/${id}`, { data });
};

/** 重置密码 */
export const resetUserPassword = (id: number, data: object) => {
  return http.request("put", `/api/users/${id}/password`, { data });
};

/** 删除用户 */
export const deleteUser = (id: number) => {
  return http.request("delete", `/api/users/${id}`);
};

/** ---------- 个人中心（自助：admin / teacher 都只改自己的） ---------- */

/** 我的资料（用户名 / 姓名 / 手机号 / 头像） */
export const getMyProfile = () => {
  return http.request("get", "/api/auth/info");
};

/** 自助改密码：需原密码；成功后后端吊销本人全部凭证 → 调用方应登出并跳登录页 */
export const updateMyPassword = (data: object) => {
  return http.request("put", "/api/auth/password", { data });
};

/** 自助改资料（姓名 / 手机号；用户名与角色不可改） */
export const updateMyProfile = (data: object) => {
  return http.request("put", "/api/auth/profile", { data });
};

/** 上传头像：原始二进制直传，后端做魔数校验（与站点 Logo 同一套判型） */
export const uploadMyAvatar = (file: File) => {
  return http.request("post", "/api/auth/avatar", {
    data: file,
    headers: { "Content-Type": file.type || "application/octet-stream" }
  });
};

/** ---------- 班级详情 / 学生导入导出 ---------- */

/** 班级学生名单 + 今日出勤概况 */
export const getClassStudents = (id: number) => {
  return http.request("get", `/api/classes/${id}/students`);
};

/** 学生全量导出（与列表同筛选，不分页） */
export const exportStudents = (params?: object) => {
  return http.request("get", "/api/students/export", { params });
};

/** 批量导入学生（前端解析 Excel 后提交 JSON 数组） */
export const importStudents = (data: object) => {
  return http.request("post", "/api/students/import", { data });
};

/** ---------- 考勤记录 / 趋势 / 预警 ---------- */

/** 考勤记录查询（分页） */
export const getAttendanceRecords = (params?: object) => {
  return http.request("get", "/api/attendance/records", { params });
};

/** 出勤趋势（period=day|week|month） */
export const getAttendanceTrend = (params?: object) => {
  return http.request("get", "/api/attendance/statistics/trend", { params });
};

/** 月度报表（班级 × 月份 出勤矩阵） */
export const getMonthlyStatistics = (params?: object) => {
  return http.request("get", "/api/attendance/statistics/monthly", { params });
};

/** 缺勤预警（低出勤率 + 连续缺勤） */
export const getAttendanceWarnings = (params?: object) => {
  return http.request("get", "/api/attendance/warnings", { params });
};

/** ---------- 课程表 ---------- */

/** 课表查询（class_id / day_of_week 过滤 + 分页） */
export const getScheduleList = (params?: object) => {
  return http.request("get", "/api/schedules", { params });
};

/** 课表全量（课程表页渲染） */
export const getAllSchedules = () => {
  return http.request("get", "/api/schedules/all");
};

/** 新增课表条目 */
export const createSchedule = (data: object) => {
  return http.request("post", "/api/schedules", { data });
};

/** 修改课表条目 */
export const updateSchedule = (id: number, data: object) => {
  return http.request("put", `/api/schedules/${id}`, { data });
};

/** 删除课表条目 */
export const deleteSchedule = (id: number) => {
  return http.request("delete", `/api/schedules/${id}`);
};

/** ---------- 学期 ---------- */

/** 学期列表（分页） */
export const getTermList = (params?: object) => {
  return http.request("get", "/api/terms", { params });
};

/** 学期下拉（全部） */
export const getAllTerms = () => {
  return http.request("get", "/api/terms/all");
};

/** 当前学期 */
export const getCurrentTerm = () => {
  return http.request("get", "/api/terms/current");
};

/** 新增学期 */
export const createTerm = (data: object) => {
  return http.request("post", "/api/terms", { data });
};

/** 修改学期 */
export const updateTerm = (id: number, data: object) => {
  return http.request("put", `/api/terms/${id}`, { data });
};

/** 设为当前学期 */
export const setCurrentTerm = (id: number) => {
  return http.request("put", `/api/terms/${id}/current`);
};

/** 删除学期 */
export const deleteTerm = (id: number) => {
  return http.request("delete", `/api/terms/${id}`);
};

/** ---------- 系统参数（仅 admin 可改） ---------- */

/** 读取全部系统参数 */
export const getSettings = () => {
  return http.request("get", "/api/settings");
};

/** 更新系统参数（整体覆盖提交的键） */
export const updateSettings = (data: object) => {
  return http.request("put", "/api/settings", { data });
};

/** ---------- 通知公告 ---------- */

/** 公告列表（分页 + 关键字） */
export const getNoticeList = (params?: object) => {
  return http.request("get", "/api/notices", { params });
};

/** 最新公告（看板用，最多 3 条） */
export const getLatestNotices = () => {
  return http.request("get", "/api/notices/latest");
};

/** 新增公告（仅 admin） */
export const createNotice = (data: object) => {
  return http.request("post", "/api/notices", { data });
};

/** 修改公告（仅 admin） */
export const updateNotice = (id: number, data: object) => {
  return http.request("put", `/api/notices/${id}`, { data });
};

/** 删除公告（仅 admin） */
export const deleteNotice = (id: number) => {
  return http.request("delete", `/api/notices/${id}`);
};

/** ---------- 数据备份（仅 admin） ---------- */

/** 备份列表 */
export const getBackupList = () => {
  return http.request("get", "/api/backups");
};

/** 立即备份 */
export const createBackup = () => {
  return http.request("post", "/api/backups");
};

/** 恢复备份（服务会重启） */
export const restoreBackup = (filename: string) => {
  return http.request("post", `/api/backups/${filename}/restore`);
};

/** 删除备份 */
export const deleteBackup = (filename: string) => {
  return http.request("delete", `/api/backups/${filename}`);
};

/** ---------- 审计日志（仅 admin） ---------- */

/** 审计日志列表（分页 + 操作人/动作/时间筛选） */
export const getAuditLogs = (params?: object) => {
  return http.request("get", "/api/audit-logs", { params });
};

/** ---------- 财务管理（报班/缴费/退费/统计） ---------- */

/** 报班订单列表（分页 + 状态/关键字/班级筛选） */
export const getFinanceOrders = (params?: object) => {
  return http.request("get", "/api/finance/orders", { params });
};

/** 订单详情（含缴费与退费明细） */
export const getFinanceOrderDetail = (id: number) => {
  return http.request("get", `/api/finance/orders/${id}`);
};

/** 新增报班订单 */
export const createFinanceOrder = (data: object) => {
  return http.request("post", "/api/finance/orders", { data });
};

/** 变更订单状态（结业/退班） */
export const updateFinanceOrderStatus = (id: number, data: object) => {
  return http.request("put", `/api/finance/orders/${id}/status`, { data });
};

/** 修改订单信息 */
export const updateFinanceOrder = (id: number, data: object) => {
  return http.request("put", `/api/finance/orders/${id}`, { data });
};

/** 删除订单（仅 admin） */
export const deleteFinanceOrder = (id: number) => {
  return http.request("delete", `/api/finance/orders/${id}`);
};

/** 缴费记录列表（分页 + 订单/关键字/支付方式/时间筛选） */
export const getFinancePayments = (params?: object) => {
  return http.request("get", "/api/finance/payments", { params });
};

/** 新增缴费记录 */
export const createFinancePayment = (data: object) => {
  return http.request("post", "/api/finance/payments", { data });
};

/** 修改缴费记录（仅 admin） */
export const updateFinancePayment = (id: number, data: object) => {
  return http.request("put", `/api/finance/payments/${id}`, { data });
};

/** 删除缴费记录（仅 admin） */
export const deleteFinancePayment = (id: number) => {
  return http.request("delete", `/api/finance/payments/${id}`);
};

/** 退费记录列表（分页 + 状态/关键字筛选） */
export const getFinanceRefunds = (params?: object) => {
  return http.request("get", "/api/finance/refunds", { params });
};

/** 提交退费申请 */
export const createFinanceRefund = (data: object) => {
  return http.request("post", "/api/finance/refunds", { data });
};

/** 退费审批（通过/驳回，仅 admin） */
export const approveFinanceRefund = (id: number, data: object) => {
  return http.request("put", `/api/finance/refunds/${id}/approve`, { data });
};

/** 删除退费记录（仅 admin） */
export const deleteFinanceRefund = (id: number) => {
  return http.request("delete", `/api/finance/refunds/${id}`);
};

/** 营收统计（granularity=day|month，start/end 时间范围） */
export const getRevenueStatistics = (params?: object) => {
  return http.request("get", "/api/finance/stats/revenue", { params });
};

/** 欠费统计（订单应缴 > 已缴的在读/结业订单） */
export const getArrearsStatistics = () => {
  return http.request("get", "/api/finance/stats/arrears");
};

/** 剩余课时不足预警（threshold 阈值，默认 5） */
export const getLowHoursStatistics = (params?: object) => {
  return http.request("get", "/api/finance/stats/low-hours", { params });
};

/** ---------- 招生线索 ---------- */

/** 线索列表（分页 + 状态/渠道/关键字筛选） */
export const getLeadList = (params?: object) => {
  return http.request("get", "/api/leads", { params });
};

/** 新增线索 */
export const createLead = (data: object) => {
  return http.request("post", "/api/leads", { data });
};

/** 修改线索 */
export const updateLead = (id: number, data: object) => {
  return http.request("put", `/api/leads/${id}`, { data });
};

/** 添加跟进记录 */
export const followLead = (id: number, data: object) => {
  return http.request("put", `/api/leads/${id}/follow`, { data });
};

/** 状态流转（新线索/跟进中/已流失） */
export const updateLeadStatus = (id: number, data: object) => {
  return http.request("put", `/api/leads/${id}/status`, { data });
};

/** 标记转化（自动创建学员档案 + 报班订单） */
export const convertLead = (id: number, data: object) => {
  return http.request("put", `/api/leads/${id}/convert`, { data });
};

/** 删除线索（仅 admin） */
export const deleteLead = (id: number) => {
  return http.request("delete", `/api/leads/${id}`);
};

/** 渠道转化统计 */
export const getChannelStats = () => {
  return http.request("get", "/api/leads/stats/channels");
};

/** ---------- 通知记录（家校留痕） ---------- */

/** 通知列表（分页 + 学员/类型/日期/已读筛选；teacher 仅本班） */
export const getNotificationList = (params?: object) => {
  return http.request("get", "/api/notifications", { params });
};

/** 标记单条已读 */
export const markNotificationRead = (id: number) => {
  return http.request("put", `/api/notifications/${id}/read`);
};

/** 全部标记已读（当前角色可视范围） */
export const markAllNotificationsRead = () => {
  return http.request("put", "/api/notifications/read-all");
};

/** ---------- 待办 ---------- */

/** 待办列表（scope=mine|all；仅 admin 可 all，teacher 传 all 也会被后端收敛为自己） */
export const getTodoList = (params?: object) => {
  return http.request("get", "/api/todos", { params });
};

/** 新建待办（owner 默认自己；admin 可传 owner_id 指派给别人） */
export const createTodo = (data: object) => {
  return http.request("post", "/api/todos", { data });
};

/** 修改待办（含标记完成：传 { status: '已完成' }） */
export const updateTodo = (id: number, data: object) => {
  return http.request("put", `/api/todos/${id}`, { data });
};

/** 删除待办 */
export const deleteTodo = (id: number) => {
  return http.request("delete", `/api/todos/${id}`);
};

/** ---------- 经营报表（仅 admin） ---------- */

/** 经营报表：招生/营收/续班/在读 汇总 */
export const getBusinessStatistics = () => {
  return http.request("get", "/api/finance/stats/business");
};

/** ---------- 排课优化：冲突检测 / 调课 / 补课（v12） ---------- */

/** 冲突检测（保存前预览：同班同段拒绝 + 同教师跨班同段警告） */
export const checkScheduleConflict = (data: object) => {
  return http.request("post", "/api/schedules/check-conflict", { data });
};

/** 调课申请列表（分页 + 状态/班级筛选；teacher 仅本班） */
export const getAdjustmentList = (params?: object) => {
  return http.request("get", "/api/schedule-adjustments", { params });
};

/** 提交调课申请 */
export const createAdjustment = (data: object) => {
  return http.request("post", "/api/schedule-adjustments", { data });
};

/** 审批调课申请（通过/驳回，仅 admin） */
export const approveAdjustment = (id: number, data: object) => {
  return http.request("put", `/api/schedule-adjustments/${id}/approve`, {
    data
  });
};

/** 撤销调课申请（申请人本人或 admin） */
export const deleteAdjustment = (id: number) => {
  return http.request("delete", `/api/schedule-adjustments/${id}`);
};

/** 补课列表（分页 + 状态/学员/日期筛选；teacher 仅本班） */
export const getMakeupList = (params?: object) => {
  return http.request("get", "/api/makeup-classes", { params });
};

/** 登记补课 */
export const createMakeup = (data: object) => {
  return http.request("post", "/api/makeup-classes", { data });
};

/** 补课状态流转（待安排/已完成；已完成联动扣减课时包） */
export const updateMakeupStatus = (id: number, data: object) => {
  return http.request("put", `/api/makeup-classes/${id}/status`, { data });
};

/** 删除补课记录 */
export const deleteMakeup = (id: number) => {
  return http.request("delete", `/api/makeup-classes/${id}`);
};
