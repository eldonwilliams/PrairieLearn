import { Router } from 'express';
import asyncHandler = require('express-async-handler');
import { loadSqlEquiv, queryOptionalRow, queryAsync, callRow } from '@prairielearn/postgres';
import * as error from '@prairielearn/error';
import type { Request } from 'express';
import { z } from 'zod';

import { CourseInstance, Lti13CourseInstanceSchema } from '../../../lib/db-types';
import { selectCoursesWithEditAccess } from '../../../models/course';
import { selectCourseInstancesWithStaffAccess } from '../../../models/course-instances';
import {
  Lti13CourseNavigationInstructor,
  Lti13CourseNavigationNotReady,
  Lti13CourseNavigationDone,
} from './lti13CourseNavigation.html';

const sql = loadSqlEquiv(__filename);
const router = Router({ mergeParams: true });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if ('done' in req.query) {
      res.send(
        Lti13CourseNavigationDone({
          resLocals: res.locals,
          lti13_instance_id: req.params.lti13_instance_id,
        }),
      );
      return;
    }

    const lti13_claims = validate_lti13_claims(req);
    const courseName = `${lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].label}: ${lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].title}`;
    let role_instructor = is_role_instructor_lti13(lti13_claims);

    // FIXME
    if ('student' in req.query) {
      role_instructor = false;
    }

    // Get lti13_course_instance info, if present
    const lci = await queryOptionalRow(
      sql.get_course_instance,
      {
        lti13_instance_id: req.params.lti13_instance_id,
        deployment_id: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/deployment_id'],
        context_id: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].id,
      },
      Lti13CourseInstanceSchema,
    );

    if (lci && !('noredir' in req.query)) {
      if (role_instructor) {
        // Update lti13_course_instance on instructor login, helpful as LMS updates or we add features
        await queryAsync(sql.upsert_lci, {
          lti13_instance_id: req.params.lti13_instance_id,
          course_instance_id: lci.course_instance_id,
          deployment_id: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/deployment_id'],
          context_id: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].id,
          context_label: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].label,
          context_title: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].title,
        });

        // TODO: Set course/instance staff permissions for LMS course staff here?
      }

      // Redirect to linked course instance
      res.redirect(
        `/pl/course_instance/${lci.course_instance_id}/${role_instructor ? 'instructor/' : ''}`,
      );
      return;
    }

    if (!role_instructor) {
      // Students get a "come back later" message
      res.send(
        Lti13CourseNavigationNotReady({
          resLocals: res.locals,
          courseName,
        }),
      );
      return;
    }

    // Instructor so lookup their existing information in PL

    let courses = await selectCoursesWithEditAccess({
      user_id: res.locals.authn_user.user_id,
      is_administrator: res.locals.authn_is_administrator,
    });

    // FIXME
    if ('nocourse' in req.query) {
      courses = [];
    }

    let course_instances: CourseInstance[] = [];

    // This should match our policy for who can link courses (only instructors? TAs?)
    for (const course of courses) {
      const loopCI = await selectCourseInstancesWithStaffAccess({
        course_id: course.id,
        user_id: res.locals.authn_user.user_id,
        authn_user_id: res.locals.authn_user.user_id,
        is_administrator: res.locals.authn_is_administrator,
        authn_is_administrator: res.locals.authn_is_administrator,
      });

      course_instances = [...course_instances, ...loopCI];
    }

    res.send(
      Lti13CourseNavigationInstructor({
        resLocals: res.locals,
        courseName,
        courses,
        course_instances,
      }),
    );
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const unsafe_course_instance_id = req.body.ci_id;
    const unsafe_lti13_instance_id = req.params.lti13_instance_id;

    const lti13_claims = validate_lti13_claims(req);
    const authn_lti13_instance_id = req.session.authn_lti13_instance_id;

    // Validate user login matches this lti13_instance
    if (unsafe_lti13_instance_id !== authn_lti13_instance_id) {
      throw error.make(403, 'Permission denied');
    }

    // Mapping of lti13_instance to institution to course instance?
    const lti_role_instructor = is_role_instructor_lti13(lti13_claims);

    const ci_role_instructor = await callRow(
      'users_is_instructor_in_course_instance',
      [res.locals.authn_user.user_id, unsafe_course_instance_id],
      z.boolean(),
    );

    if (!lti_role_instructor || !ci_role_instructor) {
      throw error.make(403, 'Permission denied');
    }

    await queryAsync(sql.insert_lci, {
      lti13_instance_id: req.params.lti13_instance_id,
      deployment_id: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/deployment_id'],
      context_id: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].id,
      context_label: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].label,
      context_title: lti13_claims['https://purl.imsglobal.org/spec/lti/claim/context'].title,
      course_instance_id: unsafe_course_instance_id,
    });

    res.redirect(`/pl/lti13_instance/${unsafe_lti13_instance_id}/course_navigation?done`);
  }),
);

export default router;

function is_role_instructor_lti13(claims, ta_is_instructor = false) {
  /*

     TA roles from Canvas development system
     [
      'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor',
      'http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student',
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
      'http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor#TeachingAssistant',
      'http://purl.imsglobal.org/vocab/lis/v2/system/person#User'
    ]
    */

  // Get roles of LTI user
  // Scoped to just this context
  // https://www.imsglobal.org/spec/lti/v1p3#lis-vocabulary-for-context-roles

  const roles = claims['https://purl.imsglobal.org/spec/lti/claim/roles'] ?? [];

  let role_instructor = roles.some((val: string) =>
    ['Instructor', 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor'].includes(val),
  );

  if (
    !ta_is_instructor &&
    roles.includes('http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor#TeachingAssistant')
  ) {
    role_instructor = false;
  }

  //console.log(roles, role_instructor);
  return role_instructor;
}

const LTI13ClaimSchema = z.object({
  exp: z.number(),
});

const LTI13ClaimContextSchema = z.object({
  'https://purl.imsglobal.org/spec/lti/claim/deployment_id': z.string(),
  'https://purl.imsglobal.org/spec/lti/claim/context': z.object({
    id: z.string(),
    label: z.string(),
    title: z.string(),
  }),
});

function validate_lti13_claims(req: Request) {
  try {
    LTI13ClaimSchema.passthrough().parse(req.session.lti13_claims);

    if (Math.floor(Date.now() / 1000) > req.session.lti13_claims.exp) {
      throw new Error();
    }
  } catch {
    delete req.session.lti13_claims;
    throw error.make(403, 'LTI session invalid or timed out, please try logging in again.');
  }

  try {
    LTI13ClaimContextSchema.passthrough().parse(req.session.lti13_claims);
  } catch {
    throw error.make(403, 'LTI context claims missing or invalid.');
  }

  console.log(req.session.lti13_claims);

  return req.session.lti13_claims;
}
