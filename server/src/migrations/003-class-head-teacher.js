// v3：班级绑定班主任账号（数据级权限）
// classes 表新增 head_teacher_id（引用 users 表教师账号），用于限定教师可见/管理本班数据
// 说明：仅 ADD COLUMN（可空、默认 NULL），不重建表；head_teacher 文本字段保留用于显示
module.exports = {
  version: 3,
  name: "班级绑定班主任账号",
  up(db) {
    db.exec("ALTER TABLE classes ADD COLUMN head_teacher_id INTEGER REFERENCES users(id);");
  }
};
