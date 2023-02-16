-- BLOCK select_group_work_assessment_with_roles
SELECT
  a.id
FROM
  assessments AS a
  JOIN assessment_sets AS aset ON (aset.id = a.assessment_set_id)
  JOIN group_configs as gc ON (gc.assessment_id = a.id)
WHERE
  a.course_instance_id = 1
  AND aset.abbreviation = 'HW'
  AND a.group_work is TRUE
  AND gc.has_roles is TRUE;

-- BLOCK get_current_user_roles
SELECT
  gr.id,
  gr.role_name,
  gr.can_assign_roles_at_start
FROM
  group_roles as gr
  JOIN group_user_roles as gu ON gr.id = gu.group_role_id
WHERE
  gr.assessment_id = $assessment_id
  AND gu.user_id = $user_id;

-- BLOCK select_group_config
SELECT
  minimum,
  maximum
FROM
  group_configs
WHERE
  assessment_id = $assessment_id
  AND deleted_at IS NULL;

-- BLOCK select_student_user
SELECT
  count(*) as result
FROM
  users AS u;

-- BLOCK generate_and_enroll_5_users
SELECT
  user_id,
  uid,
  name,
  uin
FROM
  users_randomly_generate (5, 1)
  LEFT JOIN course_instances AS ci on (ci.id = 1)
  LEFT JOIN pl_courses AS c ON (c.id = ci.course_id)
ORDER BY
  user_id;

-- BLOCK select_all_user_in_group
SELECT
  group_id,
  user_id
FROM
  group_users;

-- BLOCK select_all_assessment_instance
SELECT
  ai.*
FROM
  assessment_instances AS ai;
